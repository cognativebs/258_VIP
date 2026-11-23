/**
 * One-shot import of a JSON intelligence state file into vault_core.
 *
 *   npm run intelligence:import -w @vip/api -- [--file <state.json>] [--dry-run] [--json]
 *
 * --file defaults to VIP_INTELLIGENCE_STATE (or scripts/dev-intelligence-state.json).
 * Idempotent: ids are preserved and every insert is ON CONFLICT (id) DO NOTHING,
 * so a second run reports everything as already present. Rows whose asset,
 * holding or parent row is not in Postgres are skipped and listed — no
 * placeholder rows are created. The JSON file is read, never modified.
 * --dry-run performs the inserts inside a transaction and rolls back.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { IntelligenceImportReportSchema } from "@vip/intelligence";
import { comicsDsn, normalizeDsn, redactDsn } from "./db/client.js";
import { intelligenceStatePath, reviveDates, type IntelligenceDoc } from "./lib/intelligenceStore.js";
import { importIntelligenceDoc } from "./lib/intelligenceStorePg.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asJson = process.argv.includes("--json");
  const fileArg = arg("--file");
  const file = fileArg
    ? resolve(process.env.INIT_CWD ?? process.cwd(), fileArg)
    : intelligenceStatePath();
  if (!existsSync(file)) {
    console.error(`No intelligence state file at ${file}`);
    process.exit(1);
  }
  // Read-only: loadIntelligenceDoc() would seed or rewrite the file, so it is not used here.
  const doc = reviveDates(JSON.parse(readFileSync(file, "utf8"))) as Partial<IntelligenceDoc>;

  const dsn = comicsDsn();
  const pool = new Pool({ connectionString: normalizeDsn(dsn) });
  try {
    const report = IntelligenceImportReportSchema.parse(
      await importIntelligenceDoc(pool, doc, { dryRun, source: file }),
    );
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`${dryRun ? "[dry run — rolled back] " : ""}${file} → ${redactDsn(dsn)}`);
    for (const [name, rep] of Object.entries(report.collections)) {
      console.log(
        `  ${name.padEnd(16)} ${rep.table.padEnd(46)} json ${String(rep.inJson).padStart(4)} · inserted ${rep.inserted} · already ${rep.alreadyPresent} · skipped ${rep.skipped.length}`,
      );
      for (const s of rep.skipped.slice(0, 20)) console.log(`      skip ${s.id}: ${s.reason}`);
      if (rep.skipped.length > 20) console.log(`      … ${rep.skipped.length - 20} more`);
    }
    const t = report.totals;
    console.log(`  total: ${t.inJson} in JSON · ${t.inserted} inserted · ${t.alreadyPresent} already present · ${t.skipped} skipped`);
  } finally {
    await pool.end();
  }
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
