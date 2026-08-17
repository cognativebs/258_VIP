/**
 * Binder → VIP write bridge.
 *
 * After a local owned/wishlist toggle, notify the VIP API so it can upsert
 * durable holdings / watchlist rows. Failures are returned (not thrown) so a
 * down VIP API never blocks Binder layout edits.
 */

import { z } from "zod";

export const VIP_API = process.env.VIP_API_URL ?? "http://127.0.0.1:8787";

export type VipProjectResult = {
  ok: boolean;
  slotId?: string;
  holding?: string;
  watchlist?: string;
  error?: string;
  hint?: string;
  ruleOrModelVersion?: string;
};

export const binderDbSummarySchema = z.object({
  store: z.string().optional(),
  filledSlots: z.number().optional(),
  available: z.boolean().optional(),
  path: z.string().optional(),
});

export type BinderDbSummary = z.infer<typeof binderDbSummarySchema>;

const tcgBindersProbeSchema = z.object({
  available: z.boolean().optional(),
  store: z.string().optional(),
  dbPath: z.string().optional(),
  path: z.string().optional(),
  filledSlots: z.number().optional(),
  error: z.string().nullable().optional(),
});

type ProjectBody = {
  ok?: boolean;
  slots?: number;
  holdingsUpserted?: number;
  holdingsDeleted?: number;
  watchlistUpserted?: number;
  watchlistDeleted?: number;
  error?: string;
};

/** DSN/path with any password removed, safe to return in API payloads. */
export function redactDsn(dsn: string): string {
  return dsn
    .replace(/(password=)[^\s]+/gi, "$1***")
    .replace(/(:\/\/[^:/@]+:)[^@]+@/, "$1***@");
}

function oldApiHint(status: number): string | undefined {
  if (status === 404) {
    return (
      "The process on :8787 is an old VIP API (no Push endpoint). " +
      "Stop it, then from 258_VIP run: npm run api"
    );
  }
  return undefined;
}

const SQLITE_API_HINT =
  "The process on :8787 is reading Binder SQLite (old IQVault API). " +
  "Stop it, then from 258_VIP run: npm run api";

/** Classify VIP /api/tcg/binders (or inventory binderDb) as current Postgres vs leftover SQLite. */
export function interpretBinderDb(raw: unknown): {
  ok: boolean;
  error?: string;
  hint?: string;
  binderDb?: BinderDbSummary;
} {
  const parsed = tcgBindersProbeSchema.safeParse(raw);
  if (!parsed.success) return { ok: true };
  const row = parsed.data;
  const path = redactDsn(row.dbPath ?? row.path ?? "");
  const store = row.store;
  const binderDb: BinderDbSummary = {
    store,
    filledSlots: row.filledSlots,
    available: row.available,
    path: path || undefined,
  };
  const isSqlite =
    store === "sqlite" ||
    /\.sqlite(\b|$)/i.test(path) ||
    path.includes("binder-vault.sqlite");
  if (isSqlite) {
    return {
      ok: false,
      error: "VIP API is bound to Binder SQLite",
      hint: SQLITE_API_HINT,
      binderDb: { ...binderDb, store: store ?? "sqlite" },
    };
  }
  return { ok: true, binderDb };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

/** True when GET /health looks like the current VIP API (Postgres Binder, not leftover SQLite). */
export async function probeVipApi(): Promise<{
  ok: boolean;
  error?: string;
  hint?: string;
  health?: Record<string, unknown>;
  binderDb?: BinderDbSummary;
}> {
  try {
    const res = await fetch(`${VIP_API}/health`, { cache: "no-store" });
    const body = await readJson(res);
    if (!res.ok) {
      return {
        ok: false,
        error: `VIP /health ${res.status}`,
        hint: oldApiHint(res.status) ?? `Start VIP API: npm run api (expected ${VIP_API})`,
      };
    }
    if (body.service && body.service !== "vip-api") {
      return {
        ok: false,
        error: `Wrong service on :8787 (${String(body.service)})`,
        hint: "Stop whatever is bound to 8787, then npm run api from 258_VIP.",
      };
    }

    const bindersRes = await fetch(`${VIP_API}/api/tcg/binders`, { cache: "no-store" });
    if (bindersRes.status === 404) {
      return {
        ok: false,
        error: "VIP /api/tcg/binders 404",
        hint: oldApiHint(404),
        health: body,
      };
    }
    if (bindersRes.ok) {
      const binders = interpretBinderDb(await readJson(bindersRes));
      if (!binders.ok) {
        return { ...binders, health: body };
      }
      return { ok: true, health: body, binderDb: binders.binderDb };
    }

    return { ok: true, health: body };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "VIP API unreachable",
      hint: `Nothing accepted ${VIP_API}. In 258_VIP run: npm run api`,
    };
  }
}

export async function projectSlotToVip(slotId: string): Promise<VipProjectResult> {
  try {
    const res = await fetch(
      `${VIP_API}/api/tcg/slots/${encodeURIComponent(slotId)}/project`,
      { method: "POST", cache: "no-store" },
    );
    const body = (await readJson(res)) as VipProjectResult;
    if (!res.ok) {
      return {
        ok: false,
        error: body.error ?? `VIP project failed: ${res.status}`,
        hint: oldApiHint(res.status),
      };
    }
    return body;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "VIP API unreachable",
      hint: `Start VIP API: npm run api (expected ${VIP_API})`,
    };
  }
}

export async function projectBinderToVip(binderId?: string): Promise<{
  ok: boolean;
  slots?: number;
  holdingsUpserted?: number;
  holdingsDeleted?: number;
  watchlistUpserted?: number;
  watchlistDeleted?: number;
  error?: string;
  hint?: string;
}> {
  const probe = await probeVipApi();
  if (!probe.ok) {
    return { ok: false, error: probe.error, hint: probe.hint };
  }

  try {
    const res = await fetch(`${VIP_API}/api/tcg/project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(binderId ? { binderId } : {}),
      cache: "no-store",
    });
    const body = (await readJson(res)) as ProjectBody;
    if (!res.ok) {
      return {
        ok: false,
        error: body.error ?? `VIP project failed: ${res.status}`,
        hint:
          oldApiHint(res.status) ??
          "VIP API is up but Push failed. Check the VIP API window for a stack trace.",
      };
    }
    return { ok: true, ...body };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "VIP API unreachable",
      hint: `POST ${VIP_API}/api/tcg/project failed. Restart: npm run api`,
    };
  }
}
