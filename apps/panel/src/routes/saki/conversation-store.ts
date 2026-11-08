import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { RouteError } from "./types.js";

type Message = Record<string, unknown>;
type Store = Pick<Prisma.TransactionClient, "sakiConversationMessage" | "$queryRaw" | "$executeRaw">;

export const conversationMetadata = {
  id: true, userId: true, contextKey: true, title: true, label: true, detail: true,
  instanceId: true, createdAt: true, updatedAt: true
} as const;

const messageMetadata = { position: true, messageId: true, role: true, bytes: true } as const;
type MessageMetadata = Prisma.SakiConversationMessageGetPayload<{ select: typeof messageMetadata }>;
const historyPageBytes = 2 * 1024 * 1024;
const importTransactions = new Map<string, Promise<void>>();
let importQueue = Promise.resolve();

/** Split legacy JSON in SQLite once. Neither the old blob nor its messages cross into JS. */
export async function importConversationHistory(id: string): Promise<void> {
  const pending = importTransactions.get(id);
  if (pending) return pending;
  const [legacy] = await prisma.$queryRaw<{ pending: number | bigint }[]>`
    SELECT 1 AS pending FROM saki_conversations WHERE id = ${id} AND messages <> '[]'`;
  if (!legacy) return;
  const started = importTransactions.get(id);
  if (started) return started;
  const operation = importQueue.then(async () => {
    await prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{ kind: string }[]>`
        SELECT CASE WHEN json_valid(messages) THEN json_type(messages) ELSE 'invalid' END AS kind
        FROM saki_conversations WHERE id = ${id} AND messages <> '[]'`;
      if (!row) return;
      if (row.kind !== "array") throw new RouteError("会话存档无法解析，原始记录仍保留。", 500);
      await tx.$executeRaw`
        INSERT INTO saki_conversation_messages (conversationId, position, messageId, role, taskId, bytes, data)
        SELECT id, position, messageId, role, taskId, length(CAST(data AS BLOB)), data
        FROM (
          SELECT c.id, CAST(j.key AS INTEGER) AS position,
            CASE WHEN j.type = 'object' THEN json_extract(j.value, '$.id') END AS messageId,
            CASE WHEN j.type = 'object' THEN json_extract(j.value, '$.role') END AS role,
            CASE WHEN j.type = 'object' THEN json_extract(j.value, '$.taskId') END AS taskId,
            CASE j.type WHEN 'object' THEN j.value WHEN 'array' THEN j.value
              WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE json_quote(j.value) END AS data
          FROM saki_conversations AS c, json_each(c.messages) AS j WHERE c.id = ${id}
        )`;
      await tx.$executeRaw`UPDATE saki_conversations SET messages = '[]' WHERE id = ${id}`;
    }, { timeout: 60_000 });
  });
  importTransactions.set(id, operation);
  importQueue = operation.catch(() => {});
  try { await operation; }
  finally { importTransactions.delete(id); }
}

const isRecord = (value: unknown): value is Message => Boolean(value && typeof value === "object" && !Array.isArray(value));
const textField = (value: unknown) => typeof value === "string" ? value : null;
const observationReference = "$sakiActionObservation";

// The event retains its own status and metadata. Reuse the final action's
// observation only when its ID and full text match.
function encodeMessage(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.actions)) return { data: JSON.stringify(value), sharedBytes: 0 };
  const observations = new Map<string, string>();
  for (const action of value.actions) {
    if (isRecord(action) && typeof action.id === "string" && typeof action.observation === "string") {
      observations.set(action.id, action.observation);
    }
  }
  let sharedBytes = 0;
  const compact = (action: unknown) => {
    if (!isRecord(action) || typeof action.id !== "string" || typeof action.observation !== "string"
      || action.observation.length < 1024 || observations.get(action.id) !== action.observation) return action;
    const { observation: _observation, ...rest } = action;
    sharedBytes += Buffer.byteLength(JSON.stringify(action.observation));
    return { ...rest, [observationReference]: true };
  };
  const events = Array.isArray(value.timelineEvents) ? value.timelineEvents.map(event =>
    isRecord(event) && event.type === "action" && isRecord(event.payload)
      ? { ...event, payload: { ...event.payload, action: compact(event.payload.action) } } : event) : value.timelineEvents;
  const compactTimeline = (items: unknown) => Array.isArray(items) ? items.map(entry =>
    isRecord(entry) && entry.kind === "action" ? { ...entry, action: compact(entry.action) } : entry) : items;
  const data = JSON.stringify({ ...value, timelineEvents: events, timeline: compactTimeline(value.timeline), timelineBase: compactTimeline(value.timelineBase) });
  return { data, sharedBytes };
}

export function encodeConversationMessage(value: unknown): string {
  return encodeMessage(value).data;
}

export function decodeConversationMessage(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  if (!raw.includes(observationReference) || !isRecord(value) || !Array.isArray(value.actions)) return value;
  const observations = new Map(value.actions.filter(isRecord).map(action => [action.id, action.observation]));
  const restore = (action: unknown) => {
    if (!isRecord(action) || action[observationReference] !== true || !observations.has(action.id)) return action;
    const { [observationReference]: _reference, ...rest } = action;
    return { ...rest, observation: observations.get(action.id) };
  };
  if (Array.isArray(value.timelineEvents)) {
    for (const event of value.timelineEvents) if (isRecord(event) && event.type === "action" && isRecord(event.payload)) event.payload.action = restore(event.payload.action);
  }
  for (const key of ["timeline", "timelineBase"]) {
    const entries = value[key];
    if (Array.isArray(entries)) for (const entry of entries) if (isRecord(entry) && entry.kind === "action") entry.action = restore(entry.action);
  }
  return value;
}

export function storedMessage(conversationId: string, position: number, value: unknown, previousTaskIds?: ReadonlyMap<string, string>) {
  const message = isRecord(value) ? value : {};
  const messageId = textField(message.id);
  const retry = isRecord(message.retry) ? message.retry : null;
  const taskId = textField(message.taskId) ?? textField(retry?.taskId) ?? (messageId ? previousTaskIds?.get(messageId) ?? null : null);
  const { data, sharedBytes } = encodeMessage(taskId && !textField(message.taskId) && isRecord(value) ? { ...value, taskId } : value);
  // Bound page size by the expanded JSON, including observations shared with events.
  const bytes = Buffer.byteLength(data) + sharedBytes;
  return { conversationId, position, data, bytes, messageId, role: textField(message.role), taskId };
}

export function historyPageBounds(rows: MessageMetadata[], limit: number, beforeId?: string) {
  const end = beforeId ? rows.findIndex(row => row.messageId === beforeId) : rows.length;
  if (end < 0) throw new RouteError("History changed. Reload the conversation.", 409);
  let start = end;
  let bytes = 0;
  while (start > 0 && end - start < limit) {
    let turnStart = start - 1;
    let turnBytes = rows[turnStart]!.bytes;
    while (turnStart > 0 && rows[turnStart]!.role === "assistant") turnBytes += rows[--turnStart]!.bytes;
    // Keep ordinary questions and answers together even when the answer is
    // larger than the page target. Very large turns can still be paged.
    if (turnBytes > 32 * 1024 * 1024 && start === end && start - turnStart > 1) {
      turnStart = start - 1;
      turnBytes = rows[turnStart]!.bytes;
    }
    if (start < end && bytes + turnBytes > historyPageBytes) break;
    bytes += turnBytes;
    start = turnStart;
  }
  return { start, end, historyBeforeId: start > 0 ? rows[start]!.messageId : null };
}

export async function selectConversationPage(id: string, limit: number, beforeId?: string) {
  await importConversationHistory(id);
  const rows = await prisma.sakiConversationMessage.findMany({
    where: { conversationId: id }, orderBy: { position: "asc" }, select: messageMetadata
  });
  const { start, end, historyBeforeId } = historyPageBounds(rows, limit, beforeId);
  return { positions: rows.slice(start, end).map(row => row.position), historyBeforeId };
}

export async function readMessageAt(id: string, position: number, store: Store = prisma): Promise<unknown> {
  const row = await store.sakiConversationMessage.findUnique({
    where: { conversationId_position: { conversationId: id, position } }, select: { data: true }
  });
  return row ? decodeConversationMessage(row.data) : null;
}

export async function* iterateConversationMessages(id: string, start = 0, end?: number): AsyncGenerator<unknown> {
  await importConversationHistory(id);
  const rows = await prisma.sakiConversationMessage.findMany({
    where: { conversationId: id }, select: { position: true }, orderBy: { position: "asc" },
    skip: start, ...(end === undefined ? {} : { take: end - start })
  });
  for (const row of rows) yield await readMessageAt(id, row.position);
}

export async function* streamConversationJson(metadata: object, messages: AsyncIterable<unknown>) {
  yield `${JSON.stringify(metadata).slice(0, -1)},"messages":[`;
  let first = true;
  for await (const message of messages) {
    if (!first) yield ",";
    first = false;
    yield JSON.stringify(message);
  }
  yield "]}";
}

export async function conversationMessageCount(id: string) {
  await importConversationHistory(id);
  return prisma.sakiConversationMessage.count({ where: { conversationId: id } });
}

export async function lastConversationText(id: string) {
  await importConversationHistory(id);
  const [row] = await prisma.$queryRaw<{ content: string | null }[]>`
    SELECT CASE WHEN json_type(data, '$.content') = 'text' THEN substr(json_extract(data, '$.content'), 1, 150) END AS content
    FROM saki_conversation_messages WHERE conversationId = ${id} ORDER BY position DESC LIMIT 1`;
  return typeof row?.content === "string" ? row.content : "";
}

export async function conversationTaskMessage(id: string, taskId: string) {
  await importConversationHistory(id);
  const row = await prisma.sakiConversationMessage.findFirst({
    where: { conversationId: id, taskId, role: "assistant" }, orderBy: { position: "asc" }, select: { data: true }
  });
  const value = row ? decodeConversationMessage(row.data) : null;
  return isRecord(value) ? value : null;
}

export async function recentConversationText(id: string, limit: number) {
  await importConversationHistory(id);
  const rows = await prisma.$queryRaw<{ role: "user" | "assistant"; content: string | null; thinking: string | null }[]>`
    SELECT role, substr(json_extract(data, '$.content'), 1, 32000) AS content,
      substr(json_extract(data, '$.thinking'), 1, 32000) AS thinking
    FROM saki_conversation_messages
    WHERE conversationId = ${id} AND role IN ('user', 'assistant')
      AND coalesce(json_extract(data, '$.rollbackJournal'), 0) = 0
    ORDER BY position DESC LIMIT ${limit}`;
  return rows.reverse().map(row => ({ role: row.role, content: row.content ?? "", ...(row.thinking ? { thinking: row.thinking } : {}) }));
}

export async function conversationEditHistory(id: string, fromId?: string) {
  await importConversationHistory(id);
  const anchor = fromId ? await prisma.sakiConversationMessage.findFirst({
    where: { conversationId: id, messageId: fromId }, orderBy: { position: "asc" }, select: { position: true }
  }) : null;
  if (fromId && !anchor) throw new RouteError("History changed. Reload the conversation.", 409);
  const rows = await prisma.$queryRaw<{ id: string; role: string; content: string; rollbackJournal: number | null }[]>`
    SELECT messageId AS id, role, json_extract(data, '$.content') AS content,
      json_extract(data, '$.rollbackJournal') AS rollbackJournal
    FROM saki_conversation_messages WHERE conversationId = ${id} AND position >= ${anchor?.position ?? 0}
    ORDER BY position`;
  return rows.map(row => ({ ...row, rollbackJournal: Boolean(row.rollbackJournal) }));
}

export async function* findConversationReferences(userId: string, value: string, instanceId?: string | null) {
  const owner = { userId, ...(instanceId === undefined ? {} : { instanceId }) };
  const legacy = await prisma.sakiConversation.findMany({
    where: { ...owner, messages: { contains: value } }, select: { id: true }
  });
  for (const row of legacy) await importConversationHistory(row.id);
  const rows = await prisma.sakiConversationMessage.findMany({
    where: { conversation: owner, data: { contains: value } }, select: { conversationId: true, position: true }
  });
  for (const row of rows) yield await readMessageAt(row.conversationId, row.position);
}
