import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { binderDsn, normalizeDsn, query } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redactDsn(dsn: string): string {
  return normalizeDsn(dsn).replace(/\/\/([^:/]+):([^@]+)@/, "//$1:***@");
}

function sqliteLeftovers(): Array<{ path: string; bytes: number }> {
  const candidates = [
    resolve(process.cwd(), ".data", "binder-vault.sqlite"),
    resolve(process.cwd(), "apps", "binder-vault", ".data", "binder-vault.sqlite"),
  ];
  const seen = new Set<string>();
  const out: Array<{ path: string; bytes: number }> = [];
  for (const path of candidates) {
    if (seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    out.push({ path, bytes: statSync(path).size });
  }
  return out;
}

/**
 * Diagnostic for "Binder looks empty": which database this process reached,
 * and how many binders/pages/slots are actually there. Does not import
 * @vip/pricing, so it still answers after a git pull that has not built
 * shared packages.
 */
export async function GET() {
  const dsn = redactDsn(binderDsn());
  const sqlite = sqliteLeftovers();
  try {
    const binders = await query(`SELECT count(*)::int AS n FROM vault_tcg.binder`);
    const pages = await query(`SELECT count(*)::int AS n FROM vault_tcg.binder_page`);
    const slots = await query(`SELECT count(*)::int AS n FROM vault_tcg.binder_slot`);
    const names = await query(
      `SELECT id, name FROM vault_tcg.binder ORDER BY created_at LIMIT 20`,
    );
    return NextResponse.json({
      ok: true,
      dsn,
      cwd: process.cwd(),
      binders: binders.rows[0]?.n ?? 0,
      pages: pages.rows[0]?.n ?? 0,
      slots: slots.rows[0]?.n ?? 0,
      names: names.rows,
      sqlite,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        dsn,
        cwd: process.cwd(),
        error: e instanceof Error ? e.message : String(e),
        sqlite,
      },
      { status: 500 },
    );
  }
}
