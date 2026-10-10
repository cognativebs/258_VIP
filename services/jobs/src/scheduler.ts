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

export function startScheduler(jobs: ScheduledJob[], opts?: { runImmediately?: boolean; keepAlive?: boolean }) {
  const timers: NodeJS.Timeout[] = [];
  const runImmediately = opts?.runImmediately ?? true;
  // The scheduler is the process's only work between runs: its timers must keep it alive.
  // (Unref'd timers let Node exit quietly once a round finished — the jobs window stayed open
  // with nothing running, Oct 7.) Tests pass keepAlive: false.
  const keepAlive = opts?.keepAlive ?? true;

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
    if (!keepAlive) t.unref?.();
    timers.push(t);
  }

  return {
    stop() {
      for (const t of timers) clearInterval(t);
    },
  };
}
