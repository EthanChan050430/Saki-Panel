import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export function resolveCopilotCliPath(): string {
  const configuredPath = process.env.COPILOT_CLI_PATH?.trim();
  if (configuredPath) return configuredPath;

  // Resolve from the SDK so nested npm/pnpm dependencies work as well as hoisted ones.
  // Use the CLI's declared executable instead of inferring it from its SDK export.
  const require = createRequire(import.meta.url);
  const sdkRequire = createRequire(require.resolve("@github/copilot-sdk"));
  for (const base of sdkRequire.resolve.paths("@github/copilot") ?? []) {
    const packageDir = join(base, "@github", "copilot");
    const manifestPath = join(packageDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      bin?: string | { copilot?: string };
    };
    const executable = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.copilot;
    if (executable) {
      const cliPath = join(packageDir, executable);
      if (existsSync(cliPath)) return cliPath;
    }
  }
  throw new Error("Could not find @github/copilot CLI executable. Ensure its runtime dependencies are installed.");
}
