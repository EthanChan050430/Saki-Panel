import { RouteError } from "./routes/saki/types.js";

export function clientErrorMessage(error: unknown, statusCode: number, production: boolean): string {
  if (error instanceof Error && (!production || (error instanceof RouteError && statusCode >= 400 && statusCode < 500))) {
    return error.message;
  }
  return statusCode >= 500 ? "Internal Server Error" : "Bad Request";
}
