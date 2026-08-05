import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as schema from "./schema";

/**
 * Local SQLite (via libSQL) connection. The database file lives under
 * apps/binder-vault/.data by default (git-ignored, regenerable). Override with
 * BINDER_DB_PATH.
 *
 * libSQL ships Node-API prebuilt binaries, so this works with zero native
 * compilation on Windows / Node 20-24. Schema is created idempotently on first
 * use — setup is just: install, then dev.
 */

const DB_PATH = resolve(
  process.env.BINDER_DB_PATH ?? join(process.cwd(), ".data", "binder-vault.sqlite"),
);

export const MEDIA_DIR = resolve(
  process.env.BINDER_MEDIA_DIR ?? join(process.cwd(), ".data", "media"),
);

// libSQL wants a file: URL; use forward slashes so Windows paths parse.
const DB_URL = `file:${DB_PATH.replace(/\\/g, "/")}`;

const DDL = [
  `CREATE TABLE IF NOT EXISTS binder (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    spine_color TEXT NOT NULL DEFAULT '#7a2331',
    rows INTEGER NOT NULL DEFAULT 3,
    cols INTEGER NOT NULL DEFAULT 3,
    template TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS binder_page (
    id TEXT PRIMARY KEY,
    binder_id TEXT NOT NULL REFERENCES binder(id) ON DELETE CASCADE,
    page_index INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '#7a2331',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS page_binder_idx ON binder_page(binder_id)`,
  `CREATE TABLE IF NOT EXISTS binder_slot (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES binder_page(id) ON DELETE CASCADE,
    slot_index INTEGER NOT NULL,
    role_label TEXT NOT NULL DEFAULT '',
    is_center INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    external_id TEXT,
    card_name TEXT,
    set_name TEXT,
    number TEXT,
    rarity TEXT,
    image_url TEXT,
    image_local TEXT,
    price_market REAL,
    price_currency TEXT,
    price_updated_at INTEGER,
    provenance_method TEXT,
    provenance_source TEXT,
    provenance_model_version TEXT,
    confidence REAL,
    verification_status TEXT,
    added_at INTEGER,
    on_wishlist INTEGER NOT NULL DEFAULT 0,
    owned INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS slot_page_idx ON binder_slot(page_id)`,
];

/** Additive migrations for existing local DBs (CREATE TABLE IF NOT EXISTS won't alter). */
const MIGRATIONS = [
  `ALTER TABLE binder_slot ADD COLUMN on_wishlist INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE binder_slot ADD COLUMN owned INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE binder_slot ADD COLUMN price_updated_at INTEGER`,
  // Best-effort stamp for cards already priced before price_updated_at existed.
  `UPDATE binder_slot SET price_updated_at = added_at WHERE price_market IS NOT NULL AND price_updated_at IS NULL AND added_at IS NOT NULL`,
];

export type Db = LibSQLDatabase<typeof schema>;

let _client: Client | null = null;
let _db: Db | null = null;
let _ready: Promise<Db> | null = null;

async function initDatabase(): Promise<Db> {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  mkdirSync(MEDIA_DIR, { recursive: true });
  _client = createClient({ url: DB_URL });
  await _client.execute("PRAGMA foreign_keys = ON");
  for (const stmt of DDL) {
    await _client.execute(stmt);
  }
  for (const stmt of MIGRATIONS) {
    try {
      await _client.execute(stmt);
    } catch {
      // Column already exists — ignore.
    }
  }
  _db = drizzle(_client, { schema });
  return _db;
}

/** Get the initialized Drizzle instance (creates schema on first call). */
export function getDb(): Promise<Db> {
  if (_db) return Promise.resolve(_db);
  if (!_ready) _ready = initDatabase();
  return _ready;
}

export { schema };
