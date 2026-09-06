import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");

function safeCopy(src, dest) {
  if (!existsSync(src)) return;
  try {
    copyFileSync(src, dest);
    console.log(`Copied ${path.basename(src)} -> ${path.basename(dest)}`);
  } catch (err) {
    if (err && err.code === "EBUSY") {
      try {
        writeFileSync(dest, readFileSync(src));
        console.log(`Copied (write) ${path.basename(src)} -> ${path.basename(dest)}`);
      } catch (writeErr) {
        console.warn(`Warning: ${path.basename(dest)} is locked by a running process, skipping copy:`, writeErr.message);
      }
    } else {
      throw err;
    }
  }
}

// Copy index.js to index.mjs for ESM compatibility with tsx
const jsFile = path.join(distDir, "index.js");
const mjsFile = path.join(distDir, "index.mjs");
safeCopy(jsFile, mjsFile);

// Ensure types directory exists for declaration files
const typesDir = path.join(distDir, "types");
if (!existsSync(typesDir)) {
  mkdirSync(typesDir, { recursive: true });
}

// Copy types/index.d.ts to index.d.ts for root-level resolution
const dtsFile = path.join(typesDir, "index.d.ts");
const rootDtsFile = path.join(distDir, "index.d.ts");
safeCopy(dtsFile, rootDtsFile);
