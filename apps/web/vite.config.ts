import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hostListFromEnv(value: string | undefined): string[] | true {
  if (!value) return true;
  const entries = value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (entries.some((item) => ["*", "true", "1"].includes(item.toLowerCase()))) return true;

  const hosts = entries
    .map((item) => {
      if (item.startsWith(".")) return item;
      try {
        return new URL(item.includes("://") ? item : `http://${item}`).hostname;
      } catch {
        return item.replace(/:\d+$/, "");
      }
    })
    .filter(Boolean);

  return hosts.length > 0 ? hosts : true;
}

const host = process.env.VITE_HOST ?? "0.0.0.0";
const allowedHosts = hostListFromEnv(process.env.VITE_ALLOWED_HOSTS);
const port = numberFromEnv(process.env.VITE_PORT ?? process.env.PORT, 5478);

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    allowedHosts,
    port,
    strictPort: true
  },
  preview: {
    host,
    allowedHosts,
    port,
    strictPort: true
  }
});
