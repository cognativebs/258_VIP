import { sql } from "drizzle-orm";
import { comicsDsn, getDb, normalizeDsn, redactDsn } from "../db/client.js";
import { markInferred, markObserved } from "@vip/evidence";
import type { ApiHolding } from "./holdings.js";
import { binderPublicUrl, printedTcgName, resolveTcgCover } from "./tcgPresentation.js";

/**
 * Binder TCG layout → VIP holdings (ADR 0007).
 *
 * Reads `vault_tcg.*` in the same Postgres as comics. The SQLite file path is
 * gone from the runtime path; `dbPath` in the payload is now the redacted DSN
 * for operator diagnostics.
 */

export type BinderSummary = {
  id: string;
  name: string;
  pages: number;
  filledSlots: number;
  ownedSlots: number;
  needSlots: number;
  ownedMarketSum: number;
  needMarketSum: number;
  updatedAt: number | null;
};

export type BinderTcgPayload = {
  dbPath: string;
  available: boolean;
  holdings: ApiHolding[];
  binders: BinderSummary[];
  error?: string;
  store: "postgres";
};

/** node-pg may return snake_case or camelCase depending on the driver path. */
export function pgText(row: Record<string, unknown>, snake: string): string {
  const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const v = row[snake] ?? row[camel];
  return v == null ? "" : String(v).trim();
}

function pgBool(row: Record<string, unknown>, snake: string): boolean {
  const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const v = row[snake] ?? row[camel];
  return v === true || v === "t" || v === "true" || v === 1 || v === "1";
}

function pgNum(row: Record<string, unknown>, snake: string): number | null {
  const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const v = row[snake] ?? row[camel];
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function binderSlotToHolding(row: Record<string, unknown>): ApiHolding {
  const slotId = pgText(row, "slot_id");
  const setName = pgText(row, "set_name") || "Unknown set";
  const name = pgText(row, "card_name") || "Unnamed card";
  const number = pgText(row, "number");
  const owned = pgBool(row, "owned");
  const source = pgText(row, "source") || null;
  const externalId = pgText(row, "external_id") || null;
  const rarity = pgText(row, "rarity") || null;
  const verified = pgText(row, "verification_status").toLowerCase() === "verified";
  const conf = pgNum(row, "confidence");
  const confidence =
    conf != null
      ? conf
      : owned
        ? 0.7
        : 0.55;

  const provenance = verified
    ? markObserved({
        source: pgText(row, "provenance_source") || "binder-vault",
        ruleOrModelVersion: pgText(row, "provenance_model_version") || "binder-adapter@0.2.0",
        confidence,
      })
    : markInferred({
        source: pgText(row, "provenance_source") || "binder-vault",
        ruleOrModelVersion: pgText(row, "provenance_model_version") || "binder-adapter@0.2.0",
        notes: owned
          ? "Owned flag from Binder Vault · unverified against physical slab"
          : "Binder pocket placement · need / not marked owned",
      });

  const assetName = [setName, number && `#${number}`, name].filter(Boolean).join(" ");
  const externalIds =
    externalId && source
      ? [{ source, externalValue: externalId }]
      : externalId
        ? [{ source: "pokemontcg", externalValue: externalId }]
        : [];

  return {
    id: `binder-slot-${slotId}`,
    assetName,
    series: setName,
    issue: number,
    publisher: "The Pokémon Company",
    quantity: 1,
    pillar: owned ? "TCG Owned (Binder)" : "TCG Need (Binder)",
    museumScore: null,
    investmentScore: null,
    liquidityScore: null,
    recommendationLabel: owned ? "Hold" : "Hunt",
    sellPriority: owned ? "Low" : null,
    needsGrading: false,
    needsPhoto: false,
    needsVerification: !verified || !owned,
    verificationNotes: [
      `Binder: ${pgText(row, "binder_name")}`,
      pgText(row, "page_title")
        ? `Page: ${pgText(row, "page_title")}`
        : `Page ${(pgNum(row, "page_index") ?? 0) + 1}`,
      pgText(row, "role_label") ? `Role: ${pgText(row, "role_label")}` : null,
      rarity ? `Rarity: ${rarity}` : null,
      owned ? "Owned in Binder" : "Still needed",
    ]
      .filter(Boolean)
      .join(" · "),
    currentPrice: pgNum(row, "price_market"),
    assumedGrade: null,
    gradeRating: null,
    coverImageUrl: resolveTcgCover({
      coverImageUrl: pgText(row, "image_url") || null,
      imageLocal: pgText(row, "image_local") || null,
      binderPublicUrl: binderPublicUrl(),
      externalIds,
    }),
    cardName: printedTcgName({
      cardName: name === "Unnamed card" ? null : name,
      assetName,
      series: setName,
      issue: number,
    }),
    rarity,
    externalIds,
    provenance,
  };
}

export async function loadBinderTcg(): Promise<BinderTcgPayload> {
  const dsn = redactDsn(normalizeDsn(comicsDsn()));
  try {
    const db = getDb();
    const slotsRes = await db.execute(sql`
      SELECT
        s.id AS slot_id,
        b.id AS binder_id,
        b.name AS binder_name,
        b.updated_at AS binder_updated_at,
        p.title AS page_title,
        p.page_index AS page_index,
        s.role_label AS role_label,
        s.source AS source,
        s.external_id AS external_id,
        s.card_name AS card_name,
        s.set_name AS set_name,
        s.number AS number,
        s.rarity AS rarity,
        s.image_url AS image_url,
        s.image_local AS image_local,
        s.price_market AS price_market,
        s.owned AS owned,
        s.verification_status AS verification_status,
        s.provenance_source AS provenance_source,
        s.provenance_method AS provenance_method,
        s.provenance_model_version AS provenance_model_version,
        s.confidence AS confidence
      FROM vault_tcg.binder_slot s
      JOIN vault_tcg.binder_page p ON p.id = s.page_id
      JOIN vault_tcg.binder b ON b.id = p.binder_id
      WHERE s.source IS NOT NULL AND s.source != ''
      ORDER BY b.name, p.page_index, s.slot_index
    `);

    const rows = slotsRes.rows as unknown as Record<string, unknown>[];
    const holdings = rows.map(binderSlotToHolding);

    const binderMap = new Map<string, BinderSummary>();
    for (const row of rows) {
      const binderId = pgText(row, "binder_id");
      let summary = binderMap.get(binderId);
      if (!summary) {
        summary = {
          id: binderId,
          name: pgText(row, "binder_name"),
          pages: 0,
          filledSlots: 0,
          ownedSlots: 0,
          needSlots: 0,
          ownedMarketSum: 0,
          needMarketSum: 0,
          updatedAt: pgNum(row, "binder_updated_at"),
        };
        binderMap.set(binderId, summary);
      }
      summary.filledSlots += 1;
      const price = pgNum(row, "price_market") ?? 0;
      if (pgBool(row, "owned")) {
        summary.ownedSlots += 1;
        summary.ownedMarketSum += price;
      } else {
        summary.needSlots += 1;
        summary.needMarketSum += price;
      }
    }

    const pagesRes = await db.execute(sql`
      SELECT binder_id, COUNT(*)::int AS page_count
      FROM vault_tcg.binder_page
      GROUP BY binder_id
    `);
    for (const pr of pagesRes.rows as { binder_id: string; page_count: number }[]) {
      const summary = binderMap.get(String(pr.binder_id));
      if (summary) summary.pages = Number(pr.page_count) || 0;
    }

    const allBinders = await db.execute(sql`
      SELECT id, name, updated_at FROM vault_tcg.binder ORDER BY name
    `);
    for (const b of allBinders.rows as { id: string; name: string; updated_at: number | null }[]) {
      const id = String(b.id);
      if (binderMap.has(id)) continue;
      binderMap.set(id, {
        id,
        name: String(b.name),
        pages: 0,
        filledSlots: 0,
        ownedSlots: 0,
        needSlots: 0,
        ownedMarketSum: 0,
        needMarketSum: 0,
        updatedAt: b.updated_at != null ? Number(b.updated_at) : null,
      });
    }
    for (const pr of pagesRes.rows as { binder_id: string; page_count: number }[]) {
      const summary = binderMap.get(String(pr.binder_id));
      if (summary && summary.pages === 0) summary.pages = Number(pr.page_count) || 0;
    }

    return {
      dbPath: dsn,
      available: true,
      holdings,
      binders: [...binderMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      store: "postgres",
    };
  } catch (e) {
    return {
      dbPath: dsn,
      available: false,
      holdings: [],
      binders: [],
      store: "postgres",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
