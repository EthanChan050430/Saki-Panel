import { mkdir, open } from "node:fs/promises";
import path from "node:path";

const dbDir = path.resolve(process.cwd(), "data", "panel");
const dbFile = path.join(dbDir, "dev.db");

await mkdir(dbDir, { recursive: true });
const handle = await open(dbFile, "a");
await handle.close();

