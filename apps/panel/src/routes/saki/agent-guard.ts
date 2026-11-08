import { createHash } from "node:crypto";
import { stripThinking } from "./types.js";

export const maxIdenticalToolExecutions = 3;
export const maxConsecutiveFailedTools = 5;
export const maxNoProgressTurns = 4;
export const maxIdenticalOutputTurns = 2;
export const maxDegenerateRetries = 1;

export function agentInvestigationPressure(previous: number, fresh: number, repeated: number): number {
  if (fresh > 0 && repeated === 0) return Math.max(0, previous - 1);
  if (fresh > 0 && repeated <= fresh) return previous;
  const repeatedBatch = fresh === 0 && repeated > 1;
  return Math.min(maxNoProgressTurns, previous + (repeatedBatch ? 2 : 1));
}

export function fingerprintAgentText(text: string): string {
  const cleaned = stripThinking(text).replace(/\s+/g, " ").trim();
  return cleaned ? createHash("sha256").update(cleaned).digest("hex") : "";
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

/** Only catch claims of an edit, leaving read-only findings and real blockers alone. */
export function looksLikeCompletedWorkspaceEdit(text: string): boolean {
  const cleaned = stripThinking(text).replace(/\s+/g, " ").trim();
  return /(?:^|[。！\n.!]\s*|^[-*]\s+)(?:我\s*)?(?:(?:已(?:经)?(?:修复|改好|修改|实现|新增|重构|更新))|(?:i (?:have )?|i've )?(?:fixed|implemented|patched|updated|refactored)\b)/i.test(cleaned);
}

// Position of the last match of a global-flagged clone of `pattern`, or -1.
// `pattern` must already carry the `g` flag so matchAll advances.
function lastMatchEnd(cleaned: string, pattern: RegExp): number {
  let end = -1;
  for (const match of cleaned.matchAll(pattern)) {
    end = (match.index ?? 0) + match[0].length;
  }
  return end;
}

const completedAnswerPatternGlobal = new RegExp(completedAnswerPattern.source, "gi");
const futureToolIntentPatternGlobal = new RegExp(futureToolIntentPattern.source, "gi");

// True only for short "I'm about to use a tool" notes. Final answers that
// mention a tool name or the word "fix"/"check" must not re-enter the loop.
export function looksLikeProgressOnlyToolIntent(text: string): boolean {
  const cleaned = stripThinking(text).replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 480) return false;
  if (!actionVerbPattern.test(cleaned) || !futureToolIntentPattern.test(cleaned)) return false;
  // A completion phrase ("已完成…", "here's what…") followed by a future-intent
  // phrase is a progress note, not a final answer. Only treat the text as
  // final when the completion phrase comes *after* the last future intent.
  const completionAt = lastMatchEnd(cleaned, completedAnswerPatternGlobal);
  if (completionAt < 0) return true;
  const intentAt = lastMatchEnd(cleaned, futureToolIntentPatternGlobal);
  return intentAt > completionAt;
}

export function isDegenerateRepetition(text: string): boolean {
  const plain = stripThinking(text);
  const cleaned = plain.replace(/\s+/g, " ").trim();
  if (cleaned.length < 80) return false;

  // Scan the entire string, not just the beginning, so repetition that starts
  // after a normal preamble is also caught.
  for (const size of [12, 16, 24, 32, 48]) {
    if (cleaned.length < size * 8) continue;
    const limit = Math.min(cleaned.length, size * 20);
    for (let start = 0; start + size * 8 <= limit; start += size) {
      const chunk = cleaned.slice(start, start + size);
      let count = 0;
      for (let index = start; index + size <= limit; index += size) {
        if (cleaned.slice(index, index + size) === chunk) count += 1;
        else break;
      }
      if (count >= 8) return true;
    }
  }

  // Check any window of 10 consecutive lines, not just the first 10.
  const lines = plain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 10) {
    for (let i = 0; i <= lines.length - 10; i++) {
      const anchor = lines[i]!;
      if (anchor.length >= 6 && lines.slice(i, i + 10).every((line) => line === anchor)) return true;
    }
  }
  return false;
}

export function stuckOutputMessage(): string {
  return "模型开始循环重复同一段输出，Saki 已停止以免卡死。前面完成的操作仍然保留。你可以发「继续」让我换一种方式接着做。";
}

export function stuckNoProgressMessage(fileReadRecoveryAttempted = false): string {
  if (fileReadRecoveryAttempted) return "文件读取成功。Saki 已尝试复用读取结果继续任务，但仍连续多轮没有新进展，因此暂停了任务。已完成的操作已保留，可以补充具体修改目标或发「继续」。";
  return "Saki 多轮返回已有结果，本轮仍没有新证据，因此暂停了任务。已完成的操作仍然保留，你可以补充要求或发「继续」。";
}

export function stuckFailuresMessage(): string {
  return "连续多次工具调用失败，Saki 已停止以免反复撞同一错误。请查看上面的失败原因，修正后选择 Retry 继续任务。";
}
