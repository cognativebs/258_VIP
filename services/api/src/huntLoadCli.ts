/**
 * Load a hunt definition into vault_hunt, in one transaction.
 *
 *   npm run hunt:load -- data/hunts/marvel-midnight-universe.json
 *
 * Idempotent: re-running updates the definition (names, priorities, targets
 * still at their operator value) and never touches status, paid, owned
 * quantity or set status. Items dropped from the file are reported, not deleted.
 */
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { comicsDsn, normalizeDsn, redactDsn } from "./db/client.js";
import { loadHuntDefinition } from "./lib/huntStore.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npm run hunt:load -- <definition.json>");
    process.exit(1);
  }
  // npm -w runs in services/api; resolve against where the operator ran it.
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const dsn = comicsDsn();
  const pool = new Pool({ connectionString: normalizeDsn(dsn) });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const report = await loadHuntDefinition(client, raw, {
      file: relative(REPO_ROOT, file).split("\\").join("/"),
    });
    await client.query("COMMIT");
    console.log(`Hunt ${report.slug} → ${redactDsn(dsn)}`);
    console.log(`  hunt: ${report.huntCreated ? "created" : "updated"} (${report.huntId})`);
    console.log(`  items: ${report.itemsInserted} inserted, ${report.itemsUpdated} updated`);
    console.log(`  sets: ${report.setsUpserted} (${report.setMembers} members)`);
    if (report.notInDefinition.length) {
      console.log(`  kept, not in definition: ${report.notInDefinition.join("; ")}`);
    }
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
