import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: numberFromEnv(process.env.VITE_PORT ?? process.env.PORT, 5173),
    strictPort: true
  }
});
