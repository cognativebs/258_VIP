/**
 * Scheduled Binder price refresh (backlog E): once a day, refresh every binder's pocket prices from the
 * PriceCharting guide VIP stores, with the same code as Binder's Sync Prices button
 * (@vip/pricing syncBinderGuidePrices). Every priced pocket gets a price_snapshot row for the guide day.
 *
 * Rate limits: this job never calls the vendor. It reads the stored guide through the VIP API
 * (GET /api/pokemon/guide, 200 ids per request, one request at a time, each card id asked for once per
 * run even when it sits in several binders). The vendor calls, and their backoff, stay in pokemon-prices.
 *
 * The schedule is on by default (owner 2026-11-22); VIP_BINDER_PRICE_REFRESH=off stops it. A manual run works either way.
 *
 * Env:
 *   IQVAULT_DATABASE_DSN / DATABASE_URL   Postgres (libpq keywords or URL)
 *   VIP_API_URL                           VIP API base (default http://127.0.0.1:8787)
 *   VIP_BINDER_PRICE_REFRESH              off | 0 | false | no → the scheduler skips it (default: daily)
 */
import {
  BinderPriceSyncReportSchema,
  fetchGuidePrices,
  syncBinderGuidePrices,
  type GuideFetcher,
  type GuidePrice,
  type SqlRunner,
} from "@vip/pricing";
import { Pool } from "pg";
import { z } from "zod";
import { dsnFromEnv, runnerFromPool } from "./price-history.js";

export const BINDER_PRICE_REFRESH_JOB = "binder-price-refresh";

export const BinderPriceRefreshArgsSchema = z.object({
  dryRun: z.boolean().default(false),
  binderId: z.string().min(1).nullable().default(null),
});
export type BinderPriceRefreshArgs = z.infer<typeof BinderPriceRefreshArgsSchema>;

export const BinderPriceRefreshReportSchema = z.object({
  job: z.literal(BINDER_PRICE_REFRESH_JOB),
  ranAt: z.string(),
  triggeredBy: z.string(),
  dryRun: z.boolean(),
  bindersConsidered: z.number().int().nonnegative(),
  bindersMissing: z.array(z.string()),
  cardsRequested: z.number().int().nonnegative(),
  cardsPriced: z.number().int().nonnegative(),
  binders: z.array(BinderPriceSyncReportSchema),
  totals: z.object({
    slotsChecked: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    historyRowsNew: z.number().int().nonnegative(),
    historyRowsUpdated: z.number().int().nonnegative(),
  }),
  newestObservedOn: z.string().nullable(),
  notes: z.array(z.string()),
});
export type BinderPriceRefreshReport = z.infer<typeof BinderPriceRefreshReportSchema>;

/** The schedule's flag. Default on (owner 2026-11-22); off | 0 | false | no turns it off. */
export function binderPriceRefreshEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !["off", "0", "false", "no"].includes(String(env.VIP_BINDER_PRICE_REFRESH ?? "").trim().toLowerCase());
}

/** `[--dry-run] [--binder <id> | --binder=<id>]` */
export function parseBinderPriceRefreshArgs(argv: string[]): BinderPriceRefreshArgs {
  let dryRun = false;
  let binderId: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run" || arg === "--dryrun") dryRun = true;
    else if (arg === "--binder") {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) throw new Error("--binder needs a binder id");
      binderId = v;
      i++;
    } else if (arg.startsWith("--binder=")) {
      binderId = arg.slice("--binder=".length) || null;
      if (!binderId) throw new Error("--binder needs a binder id");
    } else {
      throw new Error(`unknown argument: ${arg} (expected --dry-run, --binder <id>)`);
    }
  }
  return BinderPriceRefreshArgsSchema.parse({ dryRun, binderId });
}

/** One guide lookup per card per run, across binders. */
export function memoGuideFetcher(fetchGuide: GuideFetcher): GuideFetcher & { requested: Set<string>; priced: Set<string> } {
  const cache = new Map<string, GuidePrice | null>();
  const requested = new Set<string>();
  const priced = new Set<string>();
  const fn = (async (ids: string[]) => {
    const missing = [...new Set(ids)].filter((id) => !cache.has(id));
    if (missing.length) {
      const got = await fetchGuide(missing);
      for (const id of missing) {
        requested.add(id);
        const g = got.get(id) ?? null;
        cache.set(id, g);
        if (g) priced.add(id);
      }
    }
    const out = new Map<string, GuidePrice>();
    for (const id of ids) {
      const g = cache.get(id);
      if (g) out.set(id, g);
    }
    return out;
  }) as GuideFetcher & { requested: Set<string>; priced: Set<string> };
  fn.requested = requested;
  fn.priced = priced;
  return fn;
}

export type BinderPriceRefreshOptions = Partial<BinderPriceRefreshArgs> & {
  runner: SqlRunner;
  fetchGuide: GuideFetcher;
  triggeredBy?: string;
  now?: () => number;
};

/** Refresh every binder (or one) with all its pages. Binders run one after another. */
export async function runBinderPriceRefresh(options: BinderPriceRefreshOptions): Promise<BinderPriceRefreshReport> {
  const dryRun = options.dryRun ?? false;
  const fetchGuide = memoGuideFetcher(options.fetchGuide);
  const ids = options.binderId
    ? [options.binderId]
    : (await options.runner(`SELECT id FROM vault_tcg.binder ORDER BY created_at ASC, id ASC`)).rows.map((r) => String(r.id));

  const report: BinderPriceRefreshReport = {
    job: BINDER_PRICE_REFRESH_JOB,
    ranAt: new Date((options.now ?? Date.now)()).toISOString(),
    triggeredBy: options.triggeredBy ?? "cli",
    dryRun,
    bindersConsidered: ids.length,
    bindersMissing: [],
    cardsRequested: 0,
    cardsPriced: 0,
    binders: [],
    totals: { slotsChecked: 0, updated: 0, unchanged: 0, skipped: 0, historyRowsNew: 0, historyRowsUpdated: 0 },
    newestObservedOn: null,
    notes: [],
  };

  for (const binderId of ids) {
    const r = await syncBinderGuidePrices({
      runner: options.runner,
      binderId,
      firstPages: null,
      fetchGuide,
      dryRun,
      now: options.now,
    });
    if (!r) {
      report.bindersMissing.push(binderId);
      continue;
    }
    report.binders.push(r);
    for (const k of Object.keys(report.totals) as Array<keyof BinderPriceRefreshReport["totals"]>) report.totals[k] += r[k];
    if (r.newestObservedOn && (!report.newestObservedOn || r.newestObservedOn > report.newestObservedOn)) {
      report.newestObservedOn = r.newestObservedOn;
    }
  }

  report.cardsRequested = fetchGuide.requested.size;
  report.cardsPriced = fetchGuide.priced.size;
  if (report.cardsRequested > 0 && report.cardsPriced === 0) {
    report.notes.push(
      "the guide returned no prices: is the VIP API up (VIP_API_URL), and has pokemon-prices run? Pockets left unchanged.",
    );
  }
  if (dryRun) report.notes.push("dry run: nothing written.");
  return BinderPriceRefreshReportSchema.parse(report);
}

export type BinderPriceRefreshJobOptions = Partial<BinderPriceRefreshArgs> & {
  triggeredBy?: string;
  dsn?: string;
  apiBase?: string;
  /** Injectable for tests. */
  fetchGuide?: GuideFetcher;
};

export async function runBinderPriceRefreshJob(options: BinderPriceRefreshJobOptions = {}): Promise<BinderPriceRefreshReport> {
  const pool = new Pool({ connectionString: options.dsn ?? dsnFromEnv(), connectionTimeoutMillis: 5000, max: 2 });
  pool.on("error", () => {
    /* idle client errors must not kill the job */
  });
  const apiBase = options.apiBase ?? process.env.VIP_API_URL;
  try {
    return await runBinderPriceRefresh({
      runner: runnerFromPool(pool),
      fetchGuide: options.fetchGuide ?? ((ids) => fetchGuidePrices(ids, { apiBase, timeoutMs: 10_000 })),
      binderId: options.binderId ?? null,
      dryRun: options.dryRun ?? false,
      triggeredBy: options.triggeredBy ?? "cli",
    });
  } finally {
    await pool.end().catch(() => {});
  }
}

export function formatBinderPriceRefreshReport(r: BinderPriceRefreshReport): string {
  const t = r.totals;
  const lines = [
    `[${r.job}]${r.dryRun ? " (dry-run)" : ""} triggeredBy=${r.triggeredBy}`,
    `  binders: ${r.binders.length}/${r.bindersConsidered}${r.bindersMissing.length ? ` (missing: ${r.bindersMissing.join(", ")})` : ""}`,
    `  cards: requested=${r.cardsRequested} priced=${r.cardsPriced}`,
    `  pockets: checked=${t.slotsChecked} updated=${t.updated} unchanged=${t.unchanged} skipped=${t.skipped}`,
    `  history: new=${t.historyRowsNew} sameDay=${t.historyRowsUpdated}`,
    `  prices as of: ${r.newestObservedOn ?? "—"}`,
  ];
  for (const n of r.notes) lines.push(`  note: ${n}`);
  return lines.join("\n");
}
