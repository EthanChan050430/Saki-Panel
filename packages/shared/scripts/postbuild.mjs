import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");

// Copy index.js to index.mjs for ESM compatibility with tsx
const jsFile = path.join(distDir, "index.js");
const mjsFile = path.join(distDir, "index.mjs");

if (existsSync(jsFile)) {
  copyFileSync(jsFile, mjsFile);
  console.log(`Copied ${path.basename(jsFile)} -> ${path.basename(mjsFile)}`);
}

// Ensure types directory exists for declaration files
const typesDir = path.join(distDir, "types");
if (!existsSync(typesDir)) {
  mkdirSync(typesDir, { recursive: true });
}

// Copy types/index.d.ts to index.d.ts for root-level resolution
const dtsFile = path.join(typesDir, "index.d.ts");
const rootDtsFile = path.join(distDir, "index.d.ts");
if (existsSync(dtsFile)) {
  copyFileSync(dtsFile, rootDtsFile);
  console.log(`Copied ${path.basename(dtsFile)} -> ${path.basename(rootDtsFile)}`);
}
