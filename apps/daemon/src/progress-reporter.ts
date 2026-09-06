// In-memory progress tracker for long-running daemon operations.
//
// Design goals:
//   - Each long-running task gets a unique ID; clients poll /api/progress/tasks/:id.
//   - Tasks auto-expire (default 2h) to avoid leaking memory.
//   - Best-effort: a dropped poll means the client just misses one update; the
//     task stays alive until the operation completes or times out.
//
// Lifecycle:
//   1. Operation starts → reporter.start(taskId, { label, totalUnits? })
//   2. Operation calls reporter.update(taskId, { workedUnits?, percentage?, message? })
//   3. Operation finishes/rejects → reporter.complete(taskId, result) or reporter.fail(taskId, error)
//   4. Client polling /api/progress/tasks/:id sees final state and stops.

export type ProgressTaskState = "running" | "completed" | "failed";

export interface ProgressTask {
  id: string;
  state: ProgressTaskState;
  label: string;
  percentage: number;           // 0 – 100
  message: string;              // human-readable current step
  workedUnits?: number;         // e.g. files processed
  totalUnits?: number;          // e.g. total files
  startedAt: number;            // ms epoch
  updatedAt: number;            // ms epoch
  completedAt?: number;         // ms epoch
  result?: unknown;             // opaque operation result (only when completed)
  error?: { code: string; message: string }; // only when failed
}

interface ProgressTaskInternal extends ProgressTask {}

const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h
const SWEEP_INTERVAL_MS = 60 * 1000;

class ProgressReporter {
  private tasks = new Map<string, ProgressTaskInternal>();
  private sweepTimer: NodeJS.Timeout | null = null;

  private ensureSweepRunning() {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Allow this timer to keep the process alive only while tasks exist.
    this.sweepTimer.unref?.();
  }

  private sweep() {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      const age = now - task.updatedAt;
      if (age > DEFAULT_MAX_AGE_MS) {
        this.tasks.delete(id);
      }
    }
    if (this.tasks.size === 0 && this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  start(
    id: string,
    opts: { label: string; totalUnits?: number; message?: string },
  ): ProgressTask {
    const now = Date.now();
    const task: ProgressTaskInternal = {
      id,
      state: "running",
      label: opts.label,
      percentage: 0,
      message: opts.message ?? "Starting…",
      workedUnits: 0,
      startedAt: now,
      updatedAt: now,
      ...(opts.totalUnits !== undefined ? { totalUnits: opts.totalUnits } : {}),
    };
    this.tasks.set(id, task);
    this.ensureSweepRunning();
    return { ...task };
  }

  update(
    id: string,
    opts: { workedUnits?: number; totalUnits?: number; percentage?: number; message?: string },
  ): ProgressTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (opts.workedUnits !== undefined) task.workedUnits = opts.workedUnits;
    if (opts.totalUnits !== undefined) task.totalUnits = opts.totalUnits;
    if (opts.percentage !== undefined) task.percentage = Math.max(0, Math.min(100, opts.percentage));
    else if (task.totalUnits && task.workedUnits !== undefined) {
      task.percentage = Math.round((task.workedUnits / task.totalUnits) * 100);
    }
    if (opts.message !== undefined) task.message = opts.message;
    task.updatedAt = Date.now();
    return { ...task };
  }

  complete(id: string, result?: unknown): ProgressTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.state = "completed";
    task.percentage = 100;
    task.message = "Completed";
    task.completedAt = Date.now();
    task.updatedAt = task.completedAt;
    if (result !== undefined) task.result = result;
    return { ...task };
  }

  fail(id: string, error: { code: string; message: string }): ProgressTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.state = "failed";
    task.error = error;
    task.completedAt = Date.now();
    task.updatedAt = task.completedAt;
    return { ...task };
  }

  get(id: string): ProgressTask | null {
    const task = this.tasks.get(id);
    return task ? { ...task } : null;
  }
}

export const progressReporter = new ProgressReporter();
