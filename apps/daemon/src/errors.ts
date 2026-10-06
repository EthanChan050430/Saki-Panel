// Unified daemon error codes. Each error carries a machine-readable code
// plus a user-facing hint so the web UI can render guided recovery actions
// (e.g. "switch to DELETE mode" for FK violations).
//
// Rules:
//  - One code per root cause, never combine two scenarios into one code.
//  - Code enum values are stable strings — they appear in persisted logs
//    and may be consumed by downstream tooling. Do not rename or reuse.
//  - The `hint` field should be short (≤ 80 chars) and actionable.

export const DaemonErrorCode = {
  // Authentication / authorization
  AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  AUTH_MISSING: "AUTH_MISSING",

  // Path / filesystem safety
  PATH_OUT_OF_BOUNDS: "PATH_OUT_OF_BOUNDS",
  PATH_SYMLINK_ESCAPE: "PATH_SYMLINK_ESCAPE",
  PATH_NOT_FOUND: "PATH_NOT_FOUND",
  PATH_NOT_FILE: "PATH_NOT_FILE",
  PATH_PERMISSION_DENIED: "PATH_PERMISSION_DENIED",
  PATH_ALREADY_EXISTS: "PATH_ALREADY_EXISTS",
  STORAGE_FULL: "STORAGE_FULL",

  // Database
  DB_AUTH_FAILED: "DB_AUTH_FAILED",
  DB_CONNECTION_FAILED: "DB_CONNECTION_FAILED",
  DB_FK_VIOLATION: "DB_FK_VIOLATION",
  DB_NOT_FOUND: "DB_NOT_FOUND",
  DB_INVALID_DEFAULT: "DB_INVALID_DEFAULT",
  DB_QUERY_FAILED: "DB_QUERY_FAILED",

  // Instance management
  INSTANCE_NOT_FOUND: "INSTANCE_NOT_FOUND",
  INSTANCE_ALREADY_RUNNING: "INSTANCE_ALREADY_RUNNING",
  INSTANCE_NOT_RUNNING: "INSTANCE_NOT_RUNNING",
  INSTANCE_START_FAILED: "INSTANCE_START_FAILED",
  INSTANCE_COMMAND_BLOCKED: "INSTANCE_COMMAND_BLOCKED",

  // Clash / subscription
  CLASH_UNSUPPORTED_PLATFORM: "CLASH_UNSUPPORTED_PLATFORM",
  CLASH_SUBSCRIPTION_INVALID_URL: "CLASH_SUBSCRIPTION_INVALID_URL",
  CLASH_SUBSCRIPTION_FETCH_FAILED: "CLASH_SUBSCRIPTION_FETCH_FAILED",
  CLASH_SUBSCRIPTION_NO_NODES: "CLASH_SUBSCRIPTION_NO_NODES",
  CLASH_CORE_DOWNLOAD_FAILED: "CLASH_CORE_DOWNLOAD_FAILED",
  CLASH_CORE_NOT_FOUND: "CLASH_CORE_NOT_FOUND",
  CLASH_PROXY_NOT_FOUND: "CLASH_PROXY_NOT_FOUND",

  // SSRF guard
  SSRF_BLOCKED: "SSRF_BLOCKED",

  // ReDoS guard
  REGEX_REJECTED: "REGEX_REJECTED",

  // Progress / long-running tasks
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  TASK_ALREADY_DONE: "TASK_ALREADY_DONE",
  TASK_ABORTED: "TASK_ABORTED",

  // System / other
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export type DaemonErrorCode = (typeof DaemonErrorCode)[keyof typeof DaemonErrorCode];

export class DaemonError extends Error {
  readonly code: DaemonErrorCode;
  readonly hint?: string;
  readonly httpStatus: number;

  constructor(code: DaemonErrorCode, message: string, hint?: string, httpStatus?: number) {
    super(message);
    this.name = "DaemonError";
    this.code = code;
    if (hint !== undefined) this.hint = hint;
    this.httpStatus = httpStatus ?? defaultStatusForCode(code);
    // Restore prototype chain for proper `instanceof` across realms.
    Object.setPrototypeOf(this, DaemonError.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      httpStatus: this.httpStatus
    };
  }
}

function defaultStatusForCode(code: DaemonErrorCode): number {
  switch (code) {
    case DaemonErrorCode.AUTH_INVALID_TOKEN:
    case DaemonErrorCode.AUTH_TOKEN_EXPIRED:
    case DaemonErrorCode.AUTH_MISSING:
      return 401;
    case DaemonErrorCode.PATH_OUT_OF_BOUNDS:
    case DaemonErrorCode.PATH_SYMLINK_ESCAPE:
    case DaemonErrorCode.SSRF_BLOCKED:
    case DaemonErrorCode.INSTANCE_COMMAND_BLOCKED:
      return 403;
    case DaemonErrorCode.PATH_NOT_FOUND:
    case DaemonErrorCode.DB_NOT_FOUND:
    case DaemonErrorCode.INSTANCE_NOT_FOUND:
    case DaemonErrorCode.TASK_NOT_FOUND:
    case DaemonErrorCode.CLASH_PROXY_NOT_FOUND:
      return 404;
    case DaemonErrorCode.REGEX_REJECTED:
    case DaemonErrorCode.DB_FK_VIOLATION:
    case DaemonErrorCode.DB_INVALID_DEFAULT:
    case DaemonErrorCode.CLASH_SUBSCRIPTION_INVALID_URL:
      return 400;
    case DaemonErrorCode.INSTANCE_ALREADY_RUNNING:
    case DaemonErrorCode.INSTANCE_NOT_RUNNING:
    case DaemonErrorCode.TASK_ALREADY_DONE:
    case DaemonErrorCode.TASK_ABORTED:
      return 409;
    case DaemonErrorCode.CLASH_UNSUPPORTED_PLATFORM:
      return 501;
    default:
      return 500;
  }
}

export function throwDaemonError(code: DaemonErrorCode, message: string, hint?: string): never {
  throw new DaemonError(code, message, hint);
}

export function isDaemonError(err: unknown): err is DaemonError {
  return err instanceof DaemonError;
}

// Expected filesystem failures must remain actionable in production. In
// particular, ENOENT is how the panel distinguishes a NEW file checkpoint.
export function normalizeDaemonFileError(error: unknown): unknown {
  if (isDaemonError(error) || !error || typeof error !== "object" || !("code" in error)) return error;
  switch (error.code) {
    case "ENOENT": return new DaemonError("PATH_NOT_FOUND", "Path not found", "Path not found (ENOENT). Check the path or create a new file.", 404);
    case "EACCES":
    case "EPERM": return new DaemonError("PATH_PERMISSION_DENIED", "Permission denied", "Permission denied. Check the daemon's filesystem permissions.", 403);
    case "EISDIR":
    case "ENOTDIR": return new DaemonError("PATH_NOT_FILE", "Wrong path type", "Wrong path type. Check whether the target and parent are files or directories.", 400);
    case "EEXIST": return new DaemonError("PATH_ALREADY_EXISTS", "Path already exists", "Path already exists. Choose another path or edit the existing file.", 409);
    case "ENOSPC": return new DaemonError("STORAGE_FULL", "Storage full", "Storage full. Free disk space before retrying.", 507);
    default: return error;
  }
}
