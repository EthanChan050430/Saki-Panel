#!/usr/bin/env node
/**
 * A dependency-free TCP readiness probe for a Minecraft Java server.
 *
 * A successful TCP connection proves that the configured port is accepting
 * connections; it does not replace a full Minecraft protocol/player journey
 * check. It is intentionally safe to use in a scheduled diagnostic task.
 */
import net from "node:net";

function usage() {
  console.log(`Usage: node check-minecraft-port.mjs [options]

Options:
  --host <hostname>      Server host (default: 127.0.0.1)
  --port <1-65535>       Server port (default: 25565)
  --timeout-ms <value>   Connection timeout (default: 3000, max: 60000)
  --help                 Show this help`);
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseInteger(value, flag, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flag} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = { host: "127.0.0.1", port: 25565, timeoutMs: 3000, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--host":
        options.host = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--port":
        options.port = parseInteger(takeValue(argv, index, arg), arg, 1, 65535);
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = parseInteger(takeValue(argv, index, arg), arg, 100, 60_000);
        index += 1;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(options.host)) {
    throw new Error("--host must be a hostname or IP address without a URL scheme.");
  }
  return options;
}

async function probe(options) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: options.host, port: options.port });
    let completed = false;
    const finish = (ok, detail) => {
      if (completed) return;
      completed = true;
      socket.destroy();
      resolve({
        ok,
        host: options.host,
        port: options.port,
        latencyMs: Date.now() - startedAt,
        detail
      });
    };
    socket.setTimeout(options.timeoutMs);
    socket.once("connect", () => finish(true, "TCP connection accepted"));
    socket.once("timeout", () => finish(false, `Timed out after ${options.timeoutMs}ms`));
    socket.once("error", (error) => finish(false, error.message));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const result = await probe(options);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Minecraft port check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
