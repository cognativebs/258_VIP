import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Postgres access for the VIP API.
 *
 * The comics schema (`vault_core`, `vault_comic`, `vault_collection`,
 * `vault_evidence`) is owned by the SQL migrations at the repo root, not by
 * Drizzle. We therefore use Drizzle as the client and query builder over that
 * legacy schema rather than restating 40+ columns as Drizzle tables that could
 * silently drift from the migrations. Schemas this service owns outright get
 * full Drizzle table definitions.
 */

export type Db = NodePgDatabase<Record<string, never>>;

const DEFAULT_DSN = "postgresql://postgres:vault@localhost:5432/iqvault";

export function comicsDsn(): string {
  return (
    process.env.IQVAULT_DATABASE_DSN ??
    process.env.DATABASE_URL ??
    DEFAULT_DSN
  );
}

/** DSN with any password removed, safe to return in API payloads and logs. */
export function redactDsn(dsn: string): string {
  return dsn
    .replace(/(password=)[^\s]+/gi, "$1***")
    .replace(/(:\/\/[^:/@]+:)[^@]+@/, "$1***@");
}

let pool: Pool | null = null;
let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    pool = new Pool({
      connectionString: normalizeDsn(comicsDsn()),
      // Fail fast: a stuck database must not hang a page load. The web client
      // has its own timeout, but the server should give up first.
      connectionTimeoutMillis: Number(process.env.VIP_DB_CONNECT_TIMEOUT_MS ?? 4000),
      max: Number(process.env.VIP_DB_POOL_MAX ?? 5),
    });
    pool.on("error", () => {
      // Idle client errors must not take the process down; queries surface
      // their own failures to the caller.
    });
    db = drizzle(pool);
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}

/**
 * The Python side uses libpq keyword DSNs ("dbname=iqvault user=postgres ...").
 * node-postgres wants a URL, so accept either and hand back a URL.
 */
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
