// Hard-abort verification: fetchWithTimeout must reject promptly when the
// ambient agent abort signal fires, even with a long request timeout.
import http from "node:http";
import { fetchWithTimeout, withAgentAbortSignal } from "../apps/panel/src/routes/saki/types.js";

const server = http.createServer(() => {
  // never respond — simulates a hung model provider
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;

const controller = new AbortController();
const started = Date.now();
setTimeout(() => controller.abort(), 200);
let outcome = "no-reject";
try {
  await withAgentAbortSignal(controller.signal, () =>
    fetchWithTimeout(`http://127.0.0.1:${port}/hang`, {}, 30000)
  );
} catch (error) {
  outcome = `rejected: ${error instanceof Error ? error.message : String(error)}`;
}
const elapsed = Date.now() - started;

server.close();
console.log(`result: ${outcome} in ${elapsed}ms`);
if (elapsed > 3000) {
  console.error("FAIL: abort did not interrupt the in-flight request promptly");
  process.exit(1);
}
console.log("PASS: in-flight request hard-aborted by task cancel signal");
process.exit(0);
