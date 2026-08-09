/** Inventory loaders for Collection Analysis — Comics API first, VIP sample fallback. */

export type ComicRow = {
  id: string;
  Series: string;
  "Issue Full": string;
  "Edition / Variant"?: string;
  Publisher?: string;
  "Collection Pillar"?: string | null;
  "Current Price"?: number | null;
  "Museum Score"?: number | null;
  "Investment Score"?: number | null;
  "Liquidity Score"?: number | null;
  Recommendation?: string | null;
  "Sell Priority"?: string | null;
  "Assumed Grade"?: string | null;
  "Needs Grading"?: string | boolean | null;
  Duplicate?: string | null;
  "Slab Status"?: string | null;
};

export type InventorySource = "comics" | "vip" | "none";

export type InventoryBundle = {
  source: InventorySource;
  meta: {
    snapshotLabel: string;
    recordCount: number;
    totalValue: number;
    note?: string;
  };
  rows: ComicRow[];
};

type VipHolding = {
  id: string;
  series: string;
  issue: string;
  publisher?: string;
  pillar?: string | null;
  currentPrice?: number | null;
  museumScore?: number | null;
  investmentScore?: number | null;
  liquidityScore?: number | null;
  recommendationLabel?: string | null;
  sellPriority?: string | null;
  assumedGrade?: string | null;
  needsGrading?: boolean;
};

function vipToComicRow(h: VipHolding): ComicRow {
  return {
    id: h.id,
    Series: h.series,
    "Issue Full": h.issue,
    Publisher: h.publisher,
    "Collection Pillar": h.pillar,
    "Current Price": h.currentPrice,
    "Museum Score": h.museumScore,
    "Investment Score": h.investmentScore,
    "Liquidity Score": h.liquidityScore,
    Recommendation: h.recommendationLabel,
    "Sell Priority": h.sellPriority,
    "Assumed Grade": h.assumedGrade,
    "Needs Grading": h.needsGrading ? "Yes" : "No",
  };
}

async function loadComics(): Promise<InventoryBundle | null> {
  try {
    const [metaRes, invRes] = await Promise.all([
      fetch("/api/comics/meta"),
      fetch("/api/comics/inventory"),
    ]);
    if (!metaRes.ok || !invRes.ok) return null;
    const meta = (await metaRes.json()) as {
      snapshotLabel?: string;
      recordCount?: number;
      totalValue?: number;
    };
    const inv = (await invRes.json()) as { inventory?: ComicRow[] } | ComicRow[];
    const rows = Array.isArray(inv) ? inv : inv.inventory || [];
    if (!rows.length) return null;
    return {
      source: "comics",
      meta: {
        snapshotLabel: meta.snapshotLabel || "Comics API",
        recordCount: meta.recordCount ?? rows.length,
        totalValue: meta.totalValue ?? 0,
        note: "Live Postgres comics inventory (catalog snapshots, not live comps).",
      },
      rows,
    };
  } catch {
    return null;
  }
}

async function loadVip(): Promise<InventoryBundle | null> {
  try {
    const res = await fetch("/api/vip/inventory");
    if (!res.ok) return null;
    const data = (await res.json()) as {
      count?: number;
      totalValueEstimate?: { amount?: number; note?: string };
      holdings?: VipHolding[];
    };
    const holdings = data.holdings || [];
    if (!holdings.length) return null;
    const rows = holdings.map(vipToComicRow);
    const total =
      data.totalValueEstimate?.amount ??
      rows.reduce((s, r) => s + (r["Current Price"] ?? 0), 0);
    return {
      source: "vip",
      meta: {
        snapshotLabel: "VIP API sample inventory",
        recordCount: data.count ?? rows.length,
        totalValue: total,
        note:
          data.totalValueEstimate?.note ||
          "Seeded VIP sample — not the full vault. Values are snapshot estimates.",
      },
      rows,
    };
  } catch {
    return null;
  }
}

export async function loadInventory(): Promise<InventoryBundle> {
  const comics = await loadComics();
  if (comics) return comics;
  const vip = await loadVip();
  if (vip) return vip;
  return {
    source: "none",
    meta: {
      snapshotLabel: "No inventory",
      recordCount: 0,
      totalValue: 0,
      note: "Start Comics API (:5200) or VIP API (:8787).",
    },
    rows: [],
  };
}
