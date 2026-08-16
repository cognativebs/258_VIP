/**
 * Daily card price history job (TCGplayer source of truth).
 *
 * Thin wrapper: the sync itself lives in @vip/pricing so the CLI, the
 * scheduler, and the Binder Vault button all run the same code.
 *
 * Env:
 *   IQVAULT_DATABASE_DSN / DATABASE_URL   Postgres (libpq keywords or URL)
 *   VIP_PRICE_CONDITION                   default NM
 *   VIP_PRICE_CONCURRENCY                 default 4
 */
import {
  formatPriceSyncReport,
  syncPriceHistory,
  type CardCondition,
  type PriceHistoryAdapter,
  type PriceHistoryRange,
  type PriceSyncReport,
  type SqlRunner,
} from "@vip/pricing";
import { Pool } from "pg";

export { PRICE_HISTORY_JOB } from "@vip/pricing";
export const formatPriceHistoryReport = formatPriceSyncReport;
export type PriceHistoryReport = PriceSyncReport;

const DEFAULT_DSN = "postgresql://postgres:vault@localhost:5432/iqvault";

/** Python side uses libpq keyword DSNs; node-postgres wants a URL. */
export function normalizeDsn(dsn: string): string {
  if (/^postgres(ql)?:\/\//i.test(dsn)) return dsn;
  if (!dsn.includes("=")) return dsn;
  const parts: Record<string, string> = {};
  for (const token of dsn.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) parts[token.slice(0, eq).toLowerCase()] = token.slice(eq + 1);
  }
  const user = encodeURIComponent(parts.user ?? "postgres");
  const password = parts.password ? `:${encodeURIComponent(parts.password)}` : "";
  const host = parts.host ?? "localhost";
  const port = parts.port ?? "5432";
  const database = encodeURIComponent(parts.dbname ?? "postgres");
  return `postgresql://${user}${password}@${host}:${port}/${database}`;
}

export function dsnFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeDsn(env.IQVAULT_DATABASE_DSN ?? env.DATABASE_URL ?? DEFAULT_DSN);
}

export type PriceHistoryOptions = {
  range?: PriceHistoryRange;
  condition?: CardCondition;
  cards?: string[];
  binderId?: string | null;
  limit?: number;
  concurrency?: number;
  dryRun?: boolean;
  triggeredBy?: string;
  /** Injectable for tests. */
  adapter?: PriceHistoryAdapter;
  dsn?: string;
};

/** CLI flags: --range=daily --cards=a,b --limit=50 --concurrency=4 --dry-run */
export function parseArgs(argv: string[]): PriceHistoryOptions {
  const opts: PriceHistoryOptions = {};
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.startsWith("--")
      ? arg.slice(2).split("=", 2)
      : [arg, undefined];
    const key = (rawKey ?? "").toLowerCase();
    const value = rawValue ?? "";
    if (key === "range" && ["daily", "quarter", "annual"].includes(value)) {
      opts.range = value as PriceHistoryRange;
    } else if (key === "backfill") {
      opts.range = (["daily", "quarter", "annual"].includes(value)
        ? value
        : "annual") as PriceHistoryRange;
    } else if (key === "condition" && value) {
      opts.condition = value.toUpperCase() as CardCondition;
    } else if (key === "cards" && value) {
      opts.cards = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (key === "binder" && value) {
      opts.binderId = value;
    } else if (key === "limit" && value) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) opts.limit = Math.trunc(n);
    } else if (key === "concurrency" && value) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) opts.concurrency = Math.trunc(n);
    } else if (key === "dry-run" || key === "dryrun") {
      opts.dryRun = true;
    }
  }
  return opts;
}

export function runnerFromPool(pool: Pool): SqlRunner {
  return async (text, params) => {
    const res = await pool.query(text, params as unknown[]);
    return {
      rows: res.rows as Array<Record<string, unknown>>,
      rowCount: res.rowCount,
    };
  };
}

export async function runPriceHistoryJob(
  options: PriceHistoryOptions = {},
): Promise<PriceHistoryReport> {
  const envConcurrency = Number(process.env.VIP_PRICE_CONCURRENCY ?? 4);
  const concurrency =
    options.concurrency ??
    (Number.isFinite(envConcurrency) && envConcurrency > 0
      ? Math.trunc(envConcurrency)
      : 4);
  const condition =
    options.condition ??
    ((process.env.VIP_PRICE_CONDITION?.toUpperCase() as CardCondition | undefined) ?? "NM");

  const pool = new Pool({
    connectionString: options.dsn ?? dsnFromEnv(),
    connectionTimeoutMillis: 5000,
    max: Math.max(2, Math.min(10, concurrency + 1)),
  });
  pool.on("error", () => {
    /* idle client errors must not kill the job */
  });

  try {
    return await syncPriceHistory({
      runner: runnerFromPool(pool),
      adapter: options.adapter,
      range: options.range,
      condition,
      cards: options.cards,
      binderId: options.binderId ?? null,
      limit: options.limit,
      concurrency,
      dryRun: options.dryRun,
      triggeredBy: options.triggeredBy ?? "cli",
    });
  } finally {
    await pool.end().catch(() => {});
  }
}
