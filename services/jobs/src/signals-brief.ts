/**
 * Daily SIGNALS brief trigger (operator 2026-10-17: once a day). The scheduler
 * checks hourly; the brief runs once per local day after VIP_SIGNALS_BRIEF_HOUR
 * (default 7), so a PC that slept through the morning catches up when it wakes.
 * A failed attempt retries on the next tick, at most 3 times a day. Spend is capped
 * per day (VIP_SIGNALS_BRIEF_CAP_USD, default $1). The work itself — context,
 * Orchestr8 call, thesis gate and storage — lives in the VIP API
 * (POST /api/signals/briefs/run), so the desk and this job share one path.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { STATE_DIR } from "./espn-sports.js";

export const BRIEF_STATE_FILE = join(STATE_DIR, "signals-brief-state.json");
const MAX_ATTEMPTS_PER_DAY = 3;
const API_TIMEOUT_MS = 16 * 60 * 1000;

const BriefStateSchema = z.object({
  day: z.string().nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  succeeded: z.boolean().default(false),
  spentUsd: z.number().nonnegative().default(0),
  lastRunId: z.string().nullable().default(null),
  lastStatus: z.string().nullable().default(null),
  lastAt: z.string().nullable().default(null),
});
export type BriefState = z.infer<typeof BriefStateSchema>;

/** Local calendar day, YYYY-MM-DD. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function loadBriefState(path = BRIEF_STATE_FILE): BriefState {
  try {
    return BriefStateSchema.parse(existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
  } catch {
    return BriefStateSchema.parse({});
  }
}

export function saveBriefState(state: BriefState, path = BRIEF_STATE_FILE): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export type BriefDecision = { run: true } | { run: false; reason: string };

export function briefDue(state: BriefState, now: Date, opts: { hour: number; capUsd: number; force?: boolean }): BriefDecision {
  const today = localDay(now);
  const s = state.day === today ? state : { ...state, day: today, attempts: 0, succeeded: false, spentUsd: 0 };
  if (s.spentUsd >= opts.capUsd) return { run: false, reason: `daily cap reached ($${s.spentUsd.toFixed(4)} of $${opts.capUsd})` };
  if (opts.force) return { run: true };
  if (s.succeeded) return { run: false, reason: `today's brief is done (${s.lastRunId ?? "no run id"})` };
  if (now.getHours() < opts.hour) return { run: false, reason: `waits until ${opts.hour}:00 local` };
  if (s.attempts >= MAX_ATTEMPTS_PER_DAY) return { run: false, reason: `${s.attempts} attempts failed today; next try tomorrow` };
  return { run: true };
}

type ApiReport = { status: string; reason?: string; runId?: string | null; costUsd?: number; headline?: string; signals?: number; stored?: Record<string, unknown> };
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type BriefJobReport = { ran: boolean; reason: string; api?: ApiReport };

export async function runSignalsBriefJob(opts: {
  now?: Date;
  force?: boolean;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  statePath?: string;
} = {}): Promise<BriefJobReport> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const hour = Number(env.VIP_SIGNALS_BRIEF_HOUR ?? 7);
  const capUsd = Number(env.VIP_SIGNALS_BRIEF_CAP_USD ?? 1);
  const statePath = opts.statePath ?? BRIEF_STATE_FILE;
  let state = loadBriefState(statePath);
  if (state.day !== localDay(now)) state = { ...state, day: localDay(now), attempts: 0, succeeded: false, spentUsd: 0 };

  const decision = opts.dryRun ? ({ run: true } as const) : briefDue(state, now, { hour, capUsd, force: opts.force });
  if (!decision.run) return { ran: false, reason: decision.reason };

  const apiBase = (env.VIP_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  let api: ApiReport;
  try {
    const res = await fetchImpl(`${apiBase}/api/signals/briefs/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: Boolean(opts.dryRun) }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    api = (await res.json()) as ApiReport;
  } catch (e) {
    api = { status: "failed", reason: `VIP API unreachable at ${apiBase}: ${e instanceof Error ? e.message : e}` };
  }
  if (opts.dryRun) return { ran: true, reason: "dry run (nothing stored, no model call)", api };

  // "Nothing new" counts as done for the day; a failure or pause leaves the day open for a retry.
  const done = api.status === "succeeded" || (api.status === "skipped" && !String(api.reason).includes("already running"));
  state = {
    ...state,
    attempts: state.attempts + 1,
    succeeded: state.succeeded || done,
    spentUsd: Math.round((state.spentUsd + Number(api.costUsd ?? 0)) * 1e6) / 1e6,
    lastRunId: api.runId ?? state.lastRunId,
    lastStatus: api.status,
    lastAt: now.toISOString(),
  };
  saveBriefState(state, statePath);
  return { ran: true, reason: api.status, api };
}

export function formatBriefJobReport(r: BriefJobReport): string {
  if (!r.ran) return `VIP Job — signals-brief · not due: ${r.reason}`;
  const a = r.api ?? { status: "unknown" };
  const lines = [`VIP Job — signals-brief · status: ${a.status}${a.runId ? ` · run ${a.runId}` : ""}${a.costUsd ? ` · $${a.costUsd.toFixed(4)}` : ""}`];
  if (a.headline) lines.push(`headline: ${a.headline}`);
  if (a.signals !== undefined) lines.push(`signals sent: ${a.signals}`);
  if (a.stored) lines.push(`theses: ${JSON.stringify(a.stored)}`);
  if (a.reason) lines.push(`reason: ${a.reason}`);
  return lines.join("\n");
}
