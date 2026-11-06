import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseSakiModelSelection, sakiModelMatchesSelection, sakiModelSelectionKey, type SakiConfigResponse, type SakiModelListResponse, type SakiModelPreference } from "@webops/shared";
import { panelPaths } from "../../config.js";

const writes = new Map<string, Promise<void>>();
type PreviousSession = { userId: string; updatedAt: number; resumeState?: { input?: { model?: string | null; provider?: string | null } } };
export function lastSessionModelPreference(userId: string, sessions: Iterable<PreviousSession>): SakiModelPreference | undefined {
  let last = -1;
  let result: SakiModelPreference | undefined;
  for (const session of sessions) {
    if (session.userId !== userId || session.updatedAt <= last || !session.resumeState?.input?.model) continue;
    const selection = parseSakiModelSelection(session.resumeState.input.model, session.resumeState.input.provider);
    if (!selection.provider || !selection.model) continue;
    last = session.updatedAt;
    result = selection;
  }
  return result;
}
function preferencePath(userId: string): string {
  return path.join(panelPaths.dataDir, "saki-model-preferences", `${createHash("sha256").update(userId).digest("hex")}.json`);
}
export async function readSakiModelPreference(userId: string, sessions: Iterable<PreviousSession> = []): Promise<SakiModelPreference | undefined> {
  await writes.get(userId)?.catch(() => undefined);
  try {
    const value = JSON.parse(await fs.readFile(preferencePath(userId), "utf8"));
    if (value && typeof value.provider === "string" && value.provider && typeof value.model === "string" && value.model) {
      return { provider: value.provider, model: value.model };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return lastSessionModelPreference(userId, sessions);
}
export async function saveSakiModelPreference(userId: string, preference: SakiModelPreference): Promise<void> {
  if (!userId || !preference.provider || !preference.model) return;
  const value = JSON.stringify({ provider: preference.provider, model: preference.model });
  const file = preferencePath(userId);
  const operation = (writes.get(userId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, value, { mode: 0o600 }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
  });
  writes.set(userId, operation);
  try { await operation; } finally { if (writes.get(userId) === operation) writes.delete(userId); }
}

export function resolveSakiUserModel(config: SakiConfigResponse, preferred: SakiModelPreference | undefined, catalog: SakiModelListResponse): string {
  const fallback = config.model ? sakiModelSelectionKey({ provider: config.provider, id: config.model }) : "";
  if (!preferred || config.providerConfigs[preferred.provider]?.enabled !== true) return fallback;
  const key = sakiModelSelectionKey({ provider: preferred.provider, id: preferred.model });
  const found = catalog.models.find(model => sakiModelMatchesSelection(model, key));
  if (found) return sakiModelSelectionKey(found);
  // A catalog outage does not prove that a model disappeared.
  if (catalog.warnings.some(warning => warning.provider === preferred.provider)) return key;
  return fallback;
}
