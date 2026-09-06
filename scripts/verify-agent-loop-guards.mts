import {
  looksLikeCompletedAnswer,
  looksLikeProgressOnlyToolIntent
} from "../apps/panel/src/routes/saki/agent-guard.ts";
import { isSakiContinuationMessage } from "../apps/panel/src/routes/saki/types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

assert(
  looksLikeCompletedAnswer("已完成代码修改。请检查上述文件是否符合预期。"),
  "Chinese completion is a finished answer"
);
assert(
  looksLikeCompletedAnswer("I've finished the fix. The tests should pass now."),
  "English completion is a finished answer"
);
assert(
  !looksLikeProgressOnlyToolIntent("已完成修改。editLines 改了 src/app.ts，请检查。"),
  "Final answer that names a tool must not force another loop"
);
assert(
  !looksLikeProgressOnlyToolIntent("The test should pass after this fix."),
  "Completed-looking English must not force continue"
);
assert(
  looksLikeProgressOnlyToolIntent("I'll read the file next and then edit it."),
  "Short future tool note is progress-only"
);
assert(
  looksLikeProgressOnlyToolIntent("下一步我会读取配置再改启动命令。"),
  "Short Chinese future-intent note is progress-only"
);
assert(
  isSakiContinuationMessage("继续"),
  "bare 继续 is a continuation"
);
assert(
  isSakiContinuationMessage("请接着做"),
  "请接着做 is a continuation"
);
assert(
  !isSakiContinuationMessage("继续用中文回答，并且不要再改文件"),
  "longer 继续… instruction is a new request, not a silent resume"
);
assert(
  !isSakiContinuationMessage("接着帮我把测试也补上"),
  "接着 + new work is a new request, not a silent resume"
);

if (process.exitCode) {
  console.error("agent loop guards failed");
  process.exit(1);
}
console.log("agent loop guards passed");
