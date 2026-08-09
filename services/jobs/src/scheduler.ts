/**
 * Minimal in-process scheduler for local/dev.
 * Production would use cron / queue worker — same job function, no manual trigger.
 */
export type ScheduledJob = {
  name: string;
  /** Interval in ms */
  everyMs: number;
  run: () => void | Promise<void>;
};

export function startScheduler(jobs: ScheduledJob[], opts?: { runImmediately?: boolean }) {
  const timers: NodeJS.Timeout[] = [];
  const runImmediately = opts?.runImmediately ?? true;

  for (const job of jobs) {
    if (runImmediately) {
      void Promise.resolve(job.run()).catch((err) => {
        console.error(`[scheduler] ${job.name} failed`, err);
      });
    }
    const t = setInterval(() => {
      void Promise.resolve(job.run()).catch((err) => {
        console.error(`[scheduler] ${job.name} failed`, err);
      });
    }, job.everyMs);
    // Don't keep process alive solely for intervals in tests unless needed
    t.unref?.();
    timers.push(t);
  }

  return {
    stop() {
      for (const t of timers) clearInterval(t);
    },
  };
}
