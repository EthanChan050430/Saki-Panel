import { createHmac } from "node:crypto";
import type {
  IncidentStatus,
  IncidentTrigger,
  ManagedIncident,
  NotificationChannelType,
  NotificationEventKind
} from "@webops/shared";
import { prisma } from "../db.js";
import { readWatchPolicy } from "./policy.js";
import { getIncident } from "./incidents.js";

// 同一 incident 同一类事件的出站通知节流（内存态，避免每次状态抖动都写库）。
const notifyThrottleMs = 60 * 1000;
const notifyThrottle = new Map<string, number>();

const sendTimeoutMs = 10 * 1000;

const triggerLabels: Record<IncidentTrigger, string> = {
  crash: "崩溃",
  crash_loop: "崩溃循环",
  disk: "磁盘告警",
  memory: "内存告警",
  webhook: "外部告警",
  health: "健康检查"
};

const kindLabels: Record<NotificationEventKind, string> = {
  opened: "新事件",
  awaiting: "待批准",
  resolved: "已恢复",
  failed: "处理失败",
  escalation: "超时升级"
};

export function notificationKindForStatus(status: IncidentStatus): NotificationEventKind | null {
  switch (status) {
    case "open":
      return "opened";
    case "awaiting_approval":
      return "awaiting";
    case "resolved":
      return "resolved";
    case "failed":
    case "rolled_back":
      return "failed";
    default:
      return null;
  }
}

function parseChannelEvents(eventsJson: string): NotificationEventKind[] {
  try {
    const parsed = JSON.parse(eventsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is NotificationEventKind => typeof item === "string");
  } catch {
    return [];
  }
}

function parseChannelIds(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

function clip(value: string | null | undefined, max = 280): string {
  if (!value) return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function incidentNotificationText(incident: ManagedIncident, kind: NotificationEventKind): { title: string; text: string } {
  const title = `【Saki 值班】${kindLabels[kind]} · ${incident.instanceName}`;
  const lines = [
    `实例：${incident.instanceName}`,
    `触发：${triggerLabels[incident.trigger] ?? incident.trigger}`,
    `状态：${kindLabels[kind]}（${incident.status}）`
  ];
  const brief = clip(incident.rootCause ?? incident.summary);
  if (brief) lines.push(`摘要：${brief}`);
  lines.push(`时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  return { title, text: lines.join("\n") };
}

interface ChannelRow {
  id: string;
  name: string;
  type: string;
  url: string;
  secret: string | null;
  enabled: boolean;
  eventsJson: string;
}

async function postJson(url: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(sendTimeoutMs)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
}

async function sendToChannel(
  channel: ChannelRow,
  kind: string,
  payload: { title: string; text: string; incident: ManagedIncident | null }
): Promise<void> {
  const type = channel.type as NotificationChannelType;
  switch (type) {
    case "webhook":
      await postJson(channel.url, { kind, incident: payload.incident, text: payload.text });
      return;
    case "dingtalk": {
      let url = channel.url;
      if (channel.secret) {
        const timestamp = Date.now();
        const sign = encodeURIComponent(
          createHmac("sha256", channel.secret).update(`${timestamp}\n${channel.secret}`).digest("base64")
        );
        url = `${url}${url.includes("?") ? "&" : "?"}timestamp=${timestamp}&sign=${sign}`;
      }
      await postJson(url, { msgtype: "markdown", markdown: { title: payload.title, text: `### ${payload.title}\n\n${payload.text}` } });
      return;
    }
    case "wecom":
      await postJson(channel.url, { msgtype: "markdown", markdown: { content: `### ${payload.title}\n\n${payload.text}` } });
      return;
    case "telegram": {
      if (!channel.secret) throw new Error("telegram 渠道缺少 secret（chat_id）");
      await postJson(channel.url, { chat_id: channel.secret, text: `${payload.title}\n\n${payload.text}`, parse_mode: "Markdown" });
      return;
    }
    default:
      throw new Error(`未知渠道类型：${channel.type}`);
  }
}

async function recordDelivery(
  channelId: string,
  incidentId: string | null,
  kind: string,
  status: "success" | "failure",
  error?: string
): Promise<void> {
  try {
    await prisma.notificationDelivery.create({
      data: { channelId, incidentId, kind, status, error: error ?? null }
    });
  } catch (deliveryError) {
    console.warn("record notification delivery failed:", deliveryError instanceof Error ? deliveryError.message : deliveryError);
  }
}

async function deliverToChannel(
  channel: ChannelRow,
  kind: string,
  payload: { title: string; text: string; incident: ManagedIncident | null }
): Promise<{ ok: boolean; error?: string }> {
  try {
    await sendToChannel(channel, kind, payload);
    await recordDelivery(channel.id, payload.incident?.id ?? null, kind, "success");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`notification channel ${channel.name} (${channel.type}) delivery failed:`, message);
    await recordDelivery(channel.id, payload.incident?.id ?? null, kind, "failure", message);
    return { ok: false, error: message };
  }
}

// 出站通知主入口：按实例 watch policy 的 notifyChannelIds 找到订阅了该事件的启用渠道并发送。
// 任何失败都只记录（delivery 行 + 日志），绝不向上抛出，避免影响 SSE 推送链路。
export async function dispatchIncidentNotification(incident: ManagedIncident, kind: NotificationEventKind): Promise<void> {
  try {
    const policy = await readWatchPolicy(incident.instanceId);
    const channelIds = parseChannelIds(policy.notifyChannelIds);
    if (!channelIds.length) return;
    const channels = await prisma.notificationChannel.findMany({
      where: { id: { in: channelIds }, enabled: true }
    });
    const targets = channels.filter((channel) => parseChannelEvents(channel.eventsJson).includes(kind));
    if (!targets.length) return;

    const now = Date.now();
    const throttleKey = `${incident.id}:${kind}`;
    const lastSent = notifyThrottle.get(throttleKey) ?? 0;
    if (now - lastSent < notifyThrottleMs) return;
    notifyThrottle.set(throttleKey, now);
    // 防御性清理，避免节流表无界增长。
    if (notifyThrottle.size > 5000) {
      for (const [key, ts] of notifyThrottle) {
        if (now - ts > 60 * 60 * 1000) notifyThrottle.delete(key);
      }
    }

    const payload = { ...incidentNotificationText(incident, kind), incident };
    await Promise.all(targets.map((channel) => deliverToChannel(channel, kind, payload)));
  } catch (error) {
    console.warn("dispatch incident notification failed:", error instanceof Error ? error.message : error);
  }
}

// 渠道测试消息：不经过策略/节流，直接发送并记录一条 kind=test 的 delivery。
export async function testNotificationChannel(channelId: string): Promise<{ ok: boolean; error?: string }> {
  const channel = await prisma.notificationChannel.findUnique({ where: { id: channelId } });
  if (!channel) return { ok: false, error: "渠道不存在" };
  const payload = {
    title: "【Saki 值班】测试消息",
    text: [`渠道：${channel.name}（${channel.type}）`, `时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`].join("\n"),
    incident: null
  };
  return deliverToChannel(channel, "test", payload);
}

// 升级扫描：open/awaiting_approval 超过策略 escalationMinutes 未处理且未升级过的 incident，
// 发送 escalation 通知并标记 escalatedAt（只升级一次）。
const escalationScanIntervalMs = 60 * 1000;
let escalationScannerStarted = false;

export function startEscalationScanner(): void {
  if (escalationScannerStarted) return;
  escalationScannerStarted = true;
  const scan = async () => {
    try {
      const stale = await prisma.incident.findMany({
        where: { status: { in: ["open", "awaiting_approval"] }, escalatedAt: null },
        select: { id: true, instanceId: true, updatedAt: true }
      });
      if (!stale.length) return;
      const policyByInstance = new Map<string, number>();
      for (const row of stale) {
        let escalationMinutes = policyByInstance.get(row.instanceId);
        if (escalationMinutes === undefined) {
          const policy = await readWatchPolicy(row.instanceId);
          escalationMinutes = policy.escalationMinutes;
          policyByInstance.set(row.instanceId, escalationMinutes);
        }
        if (Date.now() - row.updatedAt.getTime() < escalationMinutes * 60 * 1000) continue;
        const incident = await getIncident(row.id);
        if (incident) {
          await dispatchIncidentNotification(incident, "escalation");
        }
        await prisma.incident.update({
          where: { id: row.id },
          data: { escalatedAt: new Date(), lastNotifiedAt: new Date() }
        });
      }
    } catch (error) {
      console.warn("escalation scan failed:", error instanceof Error ? error.message : error);
    }
  };
  const timer = setInterval(() => void scan(), escalationScanIntervalMs);
  timer.unref?.();
}
