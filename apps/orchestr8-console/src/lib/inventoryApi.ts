/** Inventory loaders for Collection Analysis — VIP platform first, Comics API fallback. */

import {
  ComicRowSchema,
  InventoryBundleSchema,
  type ComicRow,
  type InventoryBundle,
  type InventoryProvenance,
  type InventorySource,
} from "../types/analysis";

export type { ComicRow, InventoryBundle, InventorySource };

type FetchFn = typeof fetch;

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

const SNAPSHOT_TOTAL_NOTE = "catalog snapshot · unverified" as const;

function nowIso() {
  return new Date().toISOString();
}

function provenance(
  source: InventorySource,
  method: InventoryProvenance["method"],
  confidence: number
): InventoryProvenance {
  return {
    source,
    method,
    confidence,
    verificationStatus: "unverified",
  };
}

function unavailable(note: string, fetchedAt = nowIso()): InventoryBundle {
  return InventoryBundleSchema.parse({
    source: "none",
    fetchedAt,
    meta: {
      snapshotLabel: "No inventory",
      recordCount: 0,
      snapshotTotal: { amount: 0, note: SNAPSHOT_TOTAL_NOTE },
      note,
    },
    rows: [],
    provenance: provenance("none", "fallback_chain", 0),
  });
}

function vipHoldingToRow(h: VipHolding) {
  return ComicRowSchema.safeParse({
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
  });
}

async function loadComics(fetcher: FetchFn): Promise<InventoryBundle | null> {
  try {
    const [metaRes, invRes] = await Promise.all([
      fetcher("/api/comics/meta"),
      fetcher("/api/comics/inventory"),
    ]);
    if (!metaRes.ok || !invRes.ok) return null;
    const meta = (await metaRes.json()) as {
      snapshotLabel?: string;
      recordCount?: number;
      totalValue?: number;
    };
    const inv = (await invRes.json()) as { inventory?: unknown } | unknown;
    const rawRows = Array.isArray(inv) ? inv : (inv as { inventory?: unknown }).inventory || [];
    const parsedRows = ComicRowSchema.array().safeParse(rawRows);
    if (!parsedRows.success || !parsedRows.data.length) return null;
    const bundle = InventoryBundleSchema.safeParse({
      source: "comics",
      fetchedAt: nowIso(),
      meta: {
        snapshotLabel: meta.snapshotLabel || "Comics API",
        recordCount: meta.recordCount ?? parsedRows.data.length,
        snapshotTotal: {
          amount: meta.totalValue ?? 0,
          note: SNAPSHOT_TOTAL_NOTE,
        },
        note: "Live Postgres comics inventory (catalog snapshots, not live comps).",
      },
      rows: parsedRows.data,
      provenance: provenance("comics", "http_get", 0.6),
    });
    return bundle.success ? bundle.data : null;
  } catch {
    return null;
  }
}

async function loadVip(fetcher: FetchFn): Promise<InventoryBundle | null> {
  try {
    const res = await fetcher("/api/vip/inventory");
    if (!res.ok) return null;
    const data = (await res.json()) as {
      count?: number;
      comicsAvailable?: boolean;
      comicsCount?: number;
      comicsSnapshot?: { label?: string; shortHash?: string } | null;
      totalValueEstimate?: { amount?: number; note?: string };
      holdings?: VipHolding[];
    };
    const holdings = data.holdings || [];
    if (!holdings.length) return null;
    const rows: ComicRow[] = [];
    for (const h of holdings) {
      const parsed = vipHoldingToRow(h);
      if (!parsed.success) return null;
      rows.push(parsed.data);
    }
    const amount =
      data.totalValueEstimate?.amount ??
      rows.reduce((s, r) => s + (r["Current Price"] ?? 0), 0);
    const live = Boolean(data.comicsAvailable);
    const snapshotLabel = live
      ? `VIP live inventory${data.comicsSnapshot?.shortHash ? ` · ${data.comicsSnapshot.shortHash}` : ""}`
      : "VIP inventory (comics postgres unavailable)";
    const note = live
      ? `VIP inventory (${data.comicsCount ?? rows.length} comics postgres rows plus other holdings). Catalog snapshots · unverified — live comps attach separately.`
      : data.totalValueEstimate?.note ||
        "VIP inventory without comics postgres — catalog snapshots · unverified; not the full vault.";
    const bundle = InventoryBundleSchema.safeParse({
      source: "vip",
      fetchedAt: nowIso(),
      meta: {
        snapshotLabel,
        recordCount: data.count ?? rows.length,
        snapshotTotal: { amount, note: SNAPSHOT_TOTAL_NOTE },
        note,
      },
      rows,
      provenance: provenance("vip", "http_get", live ? 0.7 : 0.4),
    });
    return bundle.success ? bundle.data : null;
  } catch {
    return null;
  }
}

/** Never throws. VIP :8787 first (platform inventory + comps), Comics :5200 fallback. */
export async function loadInventory(fetcher: FetchFn = fetch): Promise<InventoryBundle> {
  const vip = await loadVip(fetcher);
  if (vip) return vip;
  const comics = await loadComics(fetcher);
  if (comics) return comics;
  return unavailable("Start VIP API (:8787) or Comics API (:5200).");
}

export { unavailable as unavailableInventory };
