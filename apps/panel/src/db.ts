import { PrismaClient } from "@prisma/client";
import { panelConfig } from "./config.js";

export const prisma = new PrismaClient({
  ...(process.env.DATABASE_URL
    ? {
        datasources: {
          db: {
            url: panelConfig.databaseUrl
          }
        }
      }
    : {}),
  log: process.env.PRISMA_LOG === "query" ? ["query", "error", "warn"] : ["error", "warn"]
});
