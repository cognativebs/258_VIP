import { sql } from "drizzle-orm";
import { comicsDsn, getDb, normalizeDsn, redactDsn } from "../db/client.js";
import { markInferred, markObserved } from "@vip/evidence";
import type { ApiHolding } from "./holdings.js";

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

type SlotJoinRow = {
  slot_id: string;
  binder_id: string;
  binder_name: string;
  page_title: string;
  page_index: number;
  role_label: string;
  source: string | null;
  external_id: string | null;
  card_name: string | null;
  set_name: string | null;
  number: string | null;
  rarity: string | null;
  image_url: string | null;
  price_market: number | null;
  owned: boolean;
  verification_status: string | null;
  provenance_source: string | null;
  provenance_method: string | null;
  provenance_model_version: string | null;
  confidence: number | null;
  binder_updated_at: number | null;
};

function slotToHolding(row: SlotJoinRow): ApiHolding {
  const setName = row.set_name?.trim() || "Unknown set";
  const name = row.card_name?.trim() || "Unnamed card";
  const number = row.number?.trim() || "";
  const owned = !!row.owned;
  const verified = (row.verification_status ?? "").toLowerCase() === "verified";
  const conf =
    typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? row.confidence
      : owned
        ? 0.7
        : 0.55;

  const provenance = verified
    ? markObserved({
        source: row.provenance_source || "binder-vault",
        ruleOrModelVersion: row.provenance_model_version || "binder-adapter@0.2.0",
        confidence: conf,
      })
    : markInferred({
        source: row.provenance_source || "binder-vault",
        ruleOrModelVersion: row.provenance_model_version || "binder-adapter@0.2.0",
        notes: owned
          ? "Owned flag from Binder Vault · unverified against physical slab"
          : "Binder pocket placement · need / not marked owned",
      });

  return {
    id: `binder-slot-${row.slot_id}`,
    assetName: [setName, number && `#${number}`, name].filter(Boolean).join(" "),
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
      `Binder: ${row.binder_name}`,
      row.page_title ? `Page: ${row.page_title}` : `Page ${row.page_index + 1}`,
      row.role_label ? `Role: ${row.role_label}` : null,
      row.rarity ? `Rarity: ${row.rarity}` : null,
      owned ? "Owned in Binder" : "Still needed",
    ]
      .filter(Boolean)
      .join(" · "),
    currentPrice:
      typeof row.price_market === "number" && Number.isFinite(row.price_market)
        ? row.price_market
        : null,
    assumedGrade: null,
    gradeRating: null,
    coverImageUrl: row.image_url?.trim() || null,
    externalIds:
      row.external_id && row.source
        ? [{ source: row.source, externalValue: row.external_id }]
        : row.external_id
          ? [{ source: "pokemontcg", externalValue: row.external_id }]
          : [],
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

    const rows = slotsRes.rows as unknown as SlotJoinRow[];
    const holdings = rows.map(slotToHolding);

    const binderMap = new Map<string, BinderSummary>();
    for (const row of rows) {
      let summary = binderMap.get(row.binder_id);
      if (!summary) {
        summary = {
          id: row.binder_id,
          name: row.binder_name,
          pages: 0,
          filledSlots: 0,
          ownedSlots: 0,
          needSlots: 0,
          ownedMarketSum: 0,
          needMarketSum: 0,
          updatedAt: row.binder_updated_at,
        };
        binderMap.set(row.binder_id, summary);
      }
      summary.filledSlots += 1;
      const price =
        typeof row.price_market === "number" && Number.isFinite(row.price_market)
          ? row.price_market
          : 0;
      if (row.owned) {
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
