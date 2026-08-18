import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { markInferred, markObserved } from "@vip/evidence";
import type { ApiHolding } from "./holdings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Monorepo root: services/api/src/lib → ../../../../ */
function defaultBinderDbPath(): string {
  return resolve(__dirname, "../../../../apps/binder-vault/.data/binder-vault.sqlite");
}

export function resolveBinderDbPath(): string {
  return resolve(process.env.BINDER_DB_PATH ?? defaultBinderDbPath());
}

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

export type BinderPageChase = {
  binderId: string;
  binderName: string;
  pageIndex: number;
  pageTitle: string;
  pageType: "museum_page" | "cultural_icons";
  totalSlots: number;
  filledSlots: number;
  ownedSlots: number;
  missingSlots: number;
  completionPct: number;
  ripVsSinglesRecommendation: "complete" | "rip_candidate" | "buy_singles";
};

export type BinderTcgPayload = {
  dbPath: string;
  available: boolean;
  holdings: ApiHolding[];
  binders: BinderSummary[];
  pages: BinderPageChase[];
  error?: string;
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
  price_market: number | null;
  owned: number;
  verification_status: string | null;
  provenance_source: string | null;
  provenance_method: string | null;
  provenance_model_version: string | null;
  confidence: number | null;
  binder_updated_at: number | null;
};

async function loadBinderPageChase(client: Client): Promise<BinderPageChase[]> {
  const res = await client.execute(`
    SELECT
      b.id AS binder_id,
      b.name AS binder_name,
      p.page_index AS page_index,
      p.title AS page_title,
      COUNT(s.id) AS total_slots,
      SUM(CASE WHEN s.source IS NOT NULL AND s.source != '' THEN 1 ELSE 0 END) AS filled_slots,
      SUM(CASE WHEN s.owned THEN 1 ELSE 0 END) AS owned_slots
    FROM binder_page p
    JOIN binder b ON b.id = p.binder_id
    LEFT JOIN binder_slot s ON s.page_id = p.id
    GROUP BY b.id, b.name, p.page_index, p.title
    ORDER BY b.name, p.page_index
  `);
  return res.rows.map((row) => {
    const total = Number(row.total_slots) || 0;
    const filled = Number(row.filled_slots) || 0;
    const owned = Number(row.owned_slots) || 0;
    const missing = Math.max(total - owned, 0);
    const pct = total === 0 ? 0 : Number(((owned / total) * 100).toFixed(1));
    const title = String(row.page_title ?? "");
    const pageType = /icon|cultural/i.test(title) ? "cultural_icons" : "museum_page";
    const ripVsSinglesRecommendation =
      missing === 0 && total > 0
        ? "complete"
        : owned / Math.max(total, 1) >= 0.85
          ? "rip_candidate"
          : "buy_singles";
    return {
      binderId: String(row.binder_id),
      binderName: String(row.binder_name),
      pageIndex: Number(row.page_index) || 0,
      pageTitle: title,
      pageType,
      totalSlots: total,
      filledSlots: filled,
      ownedSlots: owned,
      missingSlots: missing,
      completionPct: pct,
      ripVsSinglesRecommendation,
    };
  });
}

function openClient(dbPath: string): Client | null {
  if (!existsSync(dbPath)) return null;
  const url = `file:${dbPath.replace(/\\/g, "/")}`;
  return createClient({ url });
}

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
        ruleOrModelVersion: row.provenance_model_version || "binder-adapter@0.1.0",
        confidence: conf,
      })
    : markInferred({
        source: row.provenance_source || "binder-vault",
        ruleOrModelVersion: row.provenance_model_version || "binder-adapter@0.1.0",
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
    externalIds:
      row.external_id && row.source
        ? [{ source: row.source, externalValue: row.external_id }]
        : row.external_id
          ? [{ source: "pokemontcg", externalValue: row.external_id }]
          : [],
    provenance,
  };
}

/** Load filled Binder slots as VIP holdings + per-binder summaries. */
export async function loadBinderTcg(): Promise<BinderTcgPayload> {
  const dbPath = resolveBinderDbPath();
  const client = openClient(dbPath);
  if (!client) {
    return {
      dbPath,
      available: false,
      holdings: [],
      binders: [],
      pages: [],
      error: `Binder DB not found at ${dbPath}`,
    };
  }

  try {
    const slotsRes = await client.execute(`
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
        s.price_market AS price_market,
        s.owned AS owned,
        s.verification_status AS verification_status,
        s.provenance_source AS provenance_source,
        s.provenance_method AS provenance_method,
        s.provenance_model_version AS provenance_model_version,
        s.confidence AS confidence
      FROM binder_slot s
      JOIN binder_page p ON p.id = s.page_id
      JOIN binder b ON b.id = p.binder_id
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

    const pagesRes = await client.execute(`
      SELECT binder_id, COUNT(*) AS page_count
      FROM binder_page
      GROUP BY binder_id
    `);
    for (const pr of pagesRes.rows) {
      const id = String(pr.binder_id);
      const summary = binderMap.get(id);
      if (summary) summary.pages = Number(pr.page_count) || 0;
    }

    // Include empty binders (no filled slots) in summary list.
    const allBinders = await client.execute(
      `SELECT id, name, updated_at FROM binder ORDER BY name`,
    );
    for (const b of allBinders.rows) {
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
    for (const pr of pagesRes.rows) {
      const id = String(pr.binder_id);
      const summary = binderMap.get(id);
      if (summary && summary.pages === 0) summary.pages = Number(pr.page_count) || 0;
    }

    return {
      dbPath,
      available: true,
      holdings,
      binders: [...binderMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      pages: await loadBinderPageChase(client),
    };
  } catch (e) {
    return {
      dbPath,
      available: false,
      holdings: [],
      binders: [],
      pages: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    client.close();
  }
}
