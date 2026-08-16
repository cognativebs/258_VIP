import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Binder Vault → Postgres (ADR 0007).
 *
 * DSN resolution (first hit wins):
 *   BINDER_DATABASE_URL → IQVAULT_DATABASE_DSN → DATABASE_URL
 *
 * Keyword DSNs ("dbname=iqvault user=postgres …") are accepted and normalized
 * to a URL for node-postgres.
 */

export const MEDIA_DIR = resolve(
  process.env.BINDER_MEDIA_DIR ?? join(process.cwd(), ".data", "media"),
);

const DEFAULT_DSN = "postgresql://postgres:vault@localhost:5432/iqvault";

export function binderDsn(): string {
  return (
    process.env.BINDER_DATABASE_URL ??
    process.env.IQVAULT_DATABASE_DSN ??
    process.env.DATABASE_URL ??
    DEFAULT_DSN
  );
}

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

export type Db = NodePgDatabase<typeof schema>;

let _pool: Pool | null = null;
let _db: Db | null = null;
let _ready: Promise<Db> | null = null;

async function assertSchema(pool: Pool): Promise<void> {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'vault_tcg' AND table_name = 'binder'`,
  );
  if (res.rowCount === 0) {
    throw new Error(
      "vault_tcg.binder missing — apply migrations: python scripts/migrate_db.py",
    );
  }
}

async function initDatabase(): Promise<Db> {
  mkdirSync(MEDIA_DIR, { recursive: true });
  _pool = new Pool({
    connectionString: normalizeDsn(binderDsn()),
    connectionTimeoutMillis: Number(process.env.VIP_DB_CONNECT_TIMEOUT_MS ?? 4000),
    max: Number(process.env.BINDER_DB_POOL_MAX ?? 5),
  });
  await assertSchema(_pool);
  _db = drizzle(_pool, { schema });
  return _db;
}

/** Get the initialized Drizzle instance (verifies schema on first call). */
export function getDb(): Promise<Db> {
  if (_db) return Promise.resolve(_db);
  if (!_ready) _ready = initDatabase();
  return _ready;
}

export async function closeDb(): Promise<void> {
  await _pool?.end();
  _pool = null;
  _db = null;
  _ready = null;
}

/**
 * Parameterized raw SQL against the same pool, for shared packages that take an
 * injected runner (e.g. @vip/pricing's price-history sync) rather than a driver.
 */
export async function query(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> {
  await getDb();
  if (!_pool) throw new Error("Binder database pool unavailable");
  const res = await _pool.query(text, params);
  return { rows: res.rows as Array<Record<string, unknown>>, rowCount: res.rowCount };
}

export { schema };
