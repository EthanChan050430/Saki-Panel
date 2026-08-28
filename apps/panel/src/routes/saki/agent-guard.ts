import { stripThinking } from "./types.js";

export const maxIdenticalToolExecutions = 3;
export const maxConsecutiveFailedTools = 5;
export const maxNoProgressTurns = 4;
export const maxIdenticalOutputTurns = 2;
export const maxDegenerateRetries = 1;

export function fingerprintAgentText(text: string): string {
  return stripThinking(text).replace(/\s+/g, " ").trim().slice(0, 1000);
}

export function isDegenerateRepetition(text: string): boolean {
  const cleaned = stripThinking(text).replace(/\s+/g, " ").trim();
  if (cleaned.length < 80) return false;

  for (const size of [12, 16, 24, 32, 48]) {
    if (cleaned.length < size * 8) continue;
    const chunk = cleaned.slice(0, size);
    let count = 0;
    for (let index = 0; index + size <= Math.min(cleaned.length, size * 20); index += size) {
      if (cleaned.slice(index, index + size) === chunk) count += 1;
      else break;
    }
    if (count >= 8) return true;
  }

  const lines = cleaned.split(/\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 10) {
    const first = lines[0]!;
    if (first.length >= 6 && lines.slice(0, 10).every((line) => line === first)) return true;
  }
  return false;
}

export function stuckOutputMessage(): string {
  return "模型开始循环重复同一段输出，Saki 已停止以免卡死。前面完成的操作仍然保留。你可以发「继续」让我换一种方式接着做。";
}

export function stuckNoProgressMessage(): string {
  return "Saki 连续几轮没有取得新进展（重复调用或无效输出），已停止以免空转。前面完成的操作仍然保留。你可以补充要求或发「继续」。";
}

export function stuckFailuresMessage(): string {
  return "连续多次工具调用失败，Saki 已停止以免反复撞同一错误。请查看上面的失败原因，修正后发「继续」。";
}
