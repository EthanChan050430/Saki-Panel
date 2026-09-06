import { stripThinking } from "./types.js";

export const maxIdenticalToolExecutions = 3;
export const maxConsecutiveFailedTools = 5;
export const maxNoProgressTurns = 4;
export const maxIdenticalOutputTurns = 2;
export const maxDegenerateRetries = 1;

export function fingerprintAgentText(text: string): string {
  return stripThinking(text).replace(/\s+/g, " ").trim().slice(0, 1000);
}

const completedAnswerPattern =
  /(?:已完成|已经完成|完成了|已修复|已经修好|修[好完]了|改好了|处理完|搞定|就这些|以上就是|如上|总结|结论|最终回复|可以了|请检查|请查看|here's (?:the|what)|this (?:should|will) (?:fix|work)|i(?:'ve| have) (?:finished|fixed|completed|done)|all set|done\.|fixed\.)/i;

const futureToolIntentPattern =
  /(?:\bi(?:'ll| will| am going to| need to| should)\b|\bnext\s+i(?:'ll| will)?\b|\bthen\s+i(?:'ll| will)?\b|\babout to\b|\bgoing to\b|下一步|接下来|我(?:会|将|要|需要))/i;

const actionVerbPattern =
  /(?:\b(?:read|inspect|search|run|execute|call|list|check|open|edit|modify|fix|write|create|delete|verify|test)\b|look at|读取|查看|搜索|运行|执行|调用|列出|检查|打开|编辑|修改|修复|写入|创建|删除|验证)/i;

export function looksLikeCompletedAnswer(text: string): boolean {
  const cleaned = stripThinking(text).replace(/\s+/g, " ").trim();
  return cleaned.length > 0 && completedAnswerPattern.test(cleaned);
}

// True only for short "I'm about to use a tool" notes. Final answers that
// mention a tool name or the word "fix"/"check" must not re-enter the loop.
export function looksLikeProgressOnlyToolIntent(text: string): boolean {
  const cleaned = stripThinking(text).replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 480) return false;
  if (looksLikeCompletedAnswer(cleaned)) return false;
  return actionVerbPattern.test(cleaned) && futureToolIntentPattern.test(cleaned);
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
