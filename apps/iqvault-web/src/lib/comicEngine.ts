// @ts-nocheck — ported from iqvault comicEngine.js; typed callers use comicTypes.ts
/** Comics intelligence engine — filter, sort, aggregate, dashboard stats. */

export const WORKSPACES = [
  { id: "all", label: "ALL", key: "F1", desc: "Full collection" },
  { id: "personal", label: "PERSONAL", key: "F2", desc: "Personal Collection — not for routine sale" },
  { id: "investment", label: "INVEST", key: "F3", desc: "Investment Vault — sell when intelligence justifies" },
  { id: "dealer", label: "DEALER", key: "F4", desc: "Dealer Inventory — capital that exists to churn" },
  { id: "museum", label: "MUSEUM", key: "F5", desc: "Museum candidates & high museum score" },
  { id: "sell", label: "SELL", key: "F6", desc: "High & medium sell priority (excludes Personal)" },
  { id: "lot", label: "LOT", key: "F7", desc: "Sell/lot & verify-then-lot candidates" },
  { id: "liquidity", label: "LIQ MOVE", key: "F8", desc: "High liquidity — move quickly when timing is right" },
  { id: "pillar-review", label: "PILLAR?", key: "F9", desc: "Undetermined pillar (General Inventory) for review" },
  { id: "grade", label: "GRADE", key: "F10", desc: "Needs grading" },
  { id: "dupes", label: "DUPES", key: "F11", desc: "Duplicates" },
];

export const RECOMMENDATIONS = [
  "Museum Candidate",
  "Investment Hold / Review",
  "Inventory Review",
  "Sell Duplicate",
  "Sell / Lot Candidate",
  "Verify then Lot",
];

export const COLLECTION_PILLARS = [
  "Batman",
  "Absolute Universe",
  "Spider-Man",
  "X-Men",
  "Superman",
  "First Appearances",
  "Cover Art & Favorite Artists",
  "Sci-Fi",
  "Bronze & Silver Age Keys",
  "Investment Portfolio",
  "Good Girl / Risqué Covers",
  "Personal Favorites",
  "General Inventory",
];

export const SELL_PRIORITIES = ["High", "Medium", "Low"];

export const SLAB_STATUSES = ["Raw", "Slabbed", "pending"];

export const TABLE_COLUMNS = [
  { id: "Series", label: "SERIES", minWidth: 180 },
  { id: "Issue Full", label: "ISS", minWidth: 48 },
  { id: "Edition / Variant", label: "VARIANT", minWidth: 140 },
  { id: "Collection Pillar", label: "PILLAR", minWidth: 110 },
  { id: "Inventory Bucket", label: "BUCKET", minWidth: 88 },
  { id: "Current Price", label: "VALUE", minWidth: 72, numeric: true },
  { id: "Live Range", label: "LIVE", minWidth: 168 },
  { id: "Museum Score", label: "MUS", minWidth: 44, numeric: true },
  { id: "Investment Score", label: "INV", minWidth: 44, numeric: true },
  { id: "Liquidity Score", label: "LIQ", minWidth: 44, numeric: true },
  { id: "Recommendation", label: "RECOMMENDATION", minWidth: 130 },
  { id: "Sell Priority", label: "SELL", minWidth: 56 },
  { id: "Location", label: "LOCATION", minWidth: 90 },
];

/** Pokémon grid — same Bloomberg table as comics. NAME first; art lives in Inspector. */
export const POKEMON_TABLE_COLUMNS = [
  { id: "Title", label: "NAME", minWidth: 220 },
  { id: "Series", label: "SET", minWidth: 140 },
  { id: "Issue Full", label: "#", minWidth: 48 },
  { id: "Edition / Variant", label: "RARITY", minWidth: 90 },
  { id: "Current Price", label: "VALUE", minWidth: 72, numeric: true },
  { id: "Live Range", label: "LIVE", minWidth: 168 },
  { id: "Inventory Bucket", label: "BUCKET", minWidth: 88 },
  { id: "Collection Pillar", label: "STATUS", minWidth: 110 },
  { id: "Recommendation", label: "RECOMMENDATION", minWidth: 130 },
];

export const NUMERIC_FIELDS = new Set([
  "Museum Score",
  "Investment Score",
  "Liquidity Score",
  "Current Price",
  "Cover Price",
  "Purchase Price",
  "Grade Rating",
  "Quantity",
]);

export const DEFAULT_FILTERS = {
  query: "",
  pillar: "",
  bucket: "",
  location: "",
  publisher: "",
  slabStatus: "",
  sellPriority: "",
  keyOnly: false,
  duplicateOnly: false,
  needsGrading: false,
  upgradeOnly: false,
  recommendations: [],
  minPrice: "",
  maxPrice: "",
  minMuseum: 0,
  minInvestment: 0,
  minLiquidity: 0,
};

export function comicLabel(c) {
  const series = c.Series || "Unknown";
  const issue = c["Issue Full"] || c.Issue || "?";
  return `${series} #${issue}`;
}

export function comicTicker(c) {
  const price = c["Current Price"] ?? 0;
  return `${comicLabel(c)} ${price > 0 ? `$${price.toFixed(0)}` : "UNPRICED"} · LIQ ${c["Liquidity Score"] ?? 0}`;
}

export function isPillarReview(c) {
  return c["Collection Pillar"] === "General Inventory";
}

export function isHighLiquidity(c, threshold = 65) {
  return (c["Liquidity Score"] ?? 0) >= threshold && (c["Current Price"] ?? 0) > 0;
}

export function isLotCandidate(c) {
  return c.Recommendation === "Sell / Lot Candidate" || c.Recommendation === "Verify then Lot";
}

export function filterByWorkspace(rows, workspace) {
  switch (workspace) {
    case "personal":
      return rows.filter((r) => r["Inventory Bucket"] === "personal_collection");
    case "investment":
      return rows.filter((r) => r["Inventory Bucket"] === "investment_vault");
    case "dealer":
      return rows.filter((r) => r["Inventory Bucket"] === "dealer_inventory");
    case "museum":
      return rows.filter(
        (r) => r.Recommendation === "Museum Candidate" || (r["Museum Score"] ?? 0) >= 70
      );
    case "sell":
      return rows.filter(
        (r) =>
          r["Inventory Bucket"] !== "personal_collection" &&
          (r["Sell Priority"] === "High" || r["Sell Priority"] === "Medium"),
      );
    case "lot":
      return rows.filter(isLotCandidate);
    case "liquidity":
      return rows.filter((r) => isHighLiquidity(r, 65));
    case "pillar-review":
      return rows.filter(isPillarReview);
    case "grade":
      return rows.filter((r) => r["Needs Grading"] === "Yes");
    case "dupes":
      return rows.filter((r) => r.Duplicate === "Yes");
    default:
      return rows;
  }
}

export function applyComicFilters(rows, filters) {
  let out = rows;
  const q = (filters.query ?? "").trim().toLowerCase();

  if (q) {
    out = out.filter((r) => {
      const blob = [
        r.Series,
        r["Issue Full"],
        r.Title,
        r["Edition / Variant"],
        r["Collection Pillar"],
        r["Inventory Bucket"],
        r.Recommendation,
        r.Location,
        r.Publisher,
        r["Key Comic Reason"],
        r["Key Categories"],
        r.Barcode,
        r.Tags,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  if (filters.pillar) out = out.filter((r) => r["Collection Pillar"] === filters.pillar);
  if (filters.bucket) out = out.filter((r) => r["Inventory Bucket"] === filters.bucket);

  if (filters.location === "__unassigned__") {
    out = out.filter((r) => !r.Location);
  } else if (filters.location) {
    out = out.filter((r) => r.Location === filters.location);
  }

  if (filters.publisher) out = out.filter((r) => r.Publisher === filters.publisher);
  if (filters.slabStatus) out = out.filter((r) => r["Slab Status"] === filters.slabStatus);
  if (filters.sellPriority) out = out.filter((r) => r["Sell Priority"] === filters.sellPriority);

  if (filters.keyOnly) {
    out = out.filter((r) => r["Is Key Comic"] && r["Is Key Comic"] !== "No");
  }
  if (filters.duplicateOnly) out = out.filter((r) => r.Duplicate === "Yes");
  if (filters.needsGrading) out = out.filter((r) => r["Needs Grading"] === "Yes");
  if (filters.upgradeOnly) out = out.filter((r) => r["Upgrade Candidate"] === "Yes");

  if (filters.recommendations?.length) {
    out = out.filter((r) => filters.recommendations.includes(r.Recommendation));
  }

  const minP = parseFloat(filters.minPrice);
  const maxP = parseFloat(filters.maxPrice);
  if (!Number.isNaN(minP) && filters.minPrice !== "") {
    out = out.filter((r) => (r["Current Price"] ?? 0) >= minP);
  }
  if (!Number.isNaN(maxP) && filters.maxPrice !== "") {
    out = out.filter((r) => (r["Current Price"] ?? 0) <= maxP);
  }

  if (filters.minMuseum > 0) out = out.filter((r) => (r["Museum Score"] ?? 0) >= filters.minMuseum);
  if (filters.minInvestment > 0) {
    out = out.filter((r) => (r["Investment Score"] ?? 0) >= filters.minInvestment);
  }
  if (filters.minLiquidity > 0) {
    out = out.filter((r) => (r["Liquidity Score"] ?? 0) >= filters.minLiquidity);
  }

  return out;
}

/** @deprecated use applyComicFilters */
export function filterComics(rows, { query = "", pillar = "", location = "" } = {}) {
  return applyComicFilters(rows, { ...DEFAULT_FILTERS, query, pillar, location });
}

export function sortComics(rows, sortKey, direction = "desc") {
  const col = TABLE_COLUMNS.find((c) => c.id === sortKey);
  const numeric =
    sortKey === "Live Range" || col?.numeric || NUMERIC_FIELDS.has(sortKey);

  return [...rows].sort((a, b) => {
    let av = sortKey === "Live Range" ? a["Live Low"] : a[sortKey];
    let bv = sortKey === "Live Range" ? b["Live Low"] : b[sortKey];
    if (numeric) {
      av = Number(av) || 0;
      bv = Number(bv) || 0;
    } else {
      av = String(av ?? "").toLowerCase();
      bv = String(bv ?? "").toLowerCase();
    }
    if (av < bv) return direction === "asc" ? -1 : 1;
    if (av > bv) return direction === "asc" ? 1 : -1;
    return 0;
  });
}

export function paginate(rows, page, pageSize) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: safePage,
    pages,
    total,
    start: total ? start + 1 : 0,
    end: Math.min(start + pageSize, total),
  };
}

export function countActiveFilters(filters) {
  let n = 0;
  if (filters.query?.trim()) n++;
  if (filters.pillar) n++;
  if (filters.bucket) n++;
  if (filters.location) n++;
  if (filters.publisher) n++;
  if (filters.slabStatus) n++;
  if (filters.sellPriority) n++;
  if (filters.keyOnly) n++;
  if (filters.duplicateOnly) n++;
  if (filters.needsGrading) n++;
  if (filters.upgradeOnly) n++;
  if (filters.recommendations?.length) n++;
  if (filters.minPrice !== "" && filters.minPrice != null) n++;
  if (filters.maxPrice !== "" && filters.maxPrice != null) n++;
  if (filters.minMuseum > 0) n++;
  if (filters.minInvestment > 0) n++;
  if (filters.minLiquidity > 0) n++;
  return n;
}

export function getUniquePublishers(rows) {
  return [...new Set(rows.map((r) => r.Publisher).filter(Boolean))].sort();
}

export function buildDashboardStats(rows) {
  const count = rows.length;
  const totalValue = rows.reduce(
    (s, r) => s + (r["Current Price"] ?? 0) * (r.Quantity ?? 1),
    0
  );

  const pillarMap = new Map();
  const recMap = new Map();

  for (const r of rows) {
    const pillar = r["Collection Pillar"] || "Unknown";
    const rec = r.Recommendation || "Unknown";
    const val = (r["Current Price"] ?? 0) * (r.Quantity ?? 1);

    if (!pillarMap.has(pillar)) pillarMap.set(pillar, { count: 0, value: 0 });
    const p = pillarMap.get(pillar);
    p.count += 1;
    p.value += val;

    recMap.set(rec, (recMap.get(rec) ?? 0) + 1);
  }

  const byPillar = [...pillarMap.entries()]
    .map(([name, data]) => ({
      name,
      count: data.count,
      value: Math.round(data.value * 100) / 100,
      pct: count ? Math.round((data.count / count) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const byRecommendation = [...recMap.entries()]
    .map(([name, n]) => ({
      name,
      count: n,
      pct: count ? Math.round((n / count) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const liquidityMovers = rows
    .filter(
      (r) =>
        isHighLiquidity(r, 60) &&
        (isLotCandidate(r) ||
          r["Sell Priority"] === "High" ||
          r.Recommendation === "Sell Duplicate" ||
          r.Recommendation === "Inventory Review")
    )
    .sort((a, b) => (b["Liquidity Score"] ?? 0) - (a["Liquidity Score"] ?? 0));

  const moveNowValue = liquidityMovers.reduce(
    (s, r) => s + (r["Current Price"] ?? 0) * (r.Quantity ?? 1),
    0
  );

  const museum = rows.filter((r) => r.Recommendation === "Museum Candidate");
  const pillarReview = rows.filter(isPillarReview);
  const sellHigh = rows.filter((r) => r["Sell Priority"] === "High");
  const lot = rows.filter(isLotCandidate);

  const avg = (field) =>
    count ? Math.round(rows.reduce((s, r) => s + (r[field] ?? 0), 0) / count) : 0;

  return {
    count,
    totalValue: Math.round(totalValue * 100) / 100,
    avgMuseum: avg("Museum Score"),
    avgInvestment: avg("Investment Score"),
    avgLiquidity: avg("Liquidity Score"),
    byPillar,
    byRecommendation,
    museumCount: museum.length,
    museumValue: museum.reduce((s, r) => s + (r["Current Price"] ?? 0), 0),
    pillarReviewCount: pillarReview.length,
    pillarReviewValue: pillarReview.reduce((s, r) => s + (r["Current Price"] ?? 0), 0),
    sellHighCount: sellHigh.length,
    lotCount: lot.length,
    liquidityMovers: liquidityMovers.slice(0, 20),
    moveNowCount: liquidityMovers.length,
    moveNowValue: Math.round(moveNowValue * 100) / 100,
    topMuseum: [...museum]
      .sort((a, b) => (b["Museum Score"] ?? 0) - (a["Museum Score"] ?? 0))
      .slice(0, 8),
  };
}

export function scoreClass(score) {
  if (score >= 75) return "bb-score-high";
  if (score >= 50) return "bb-score-mid";
  if (score >= 25) return "bb-score-low";
  return "bb-score-min";
}

export function priorityClass(priority) {
  if (priority === "High") return "bb-priority-high";
  if (priority === "Medium") return "bb-priority-mid";
  return "bb-priority-low";
}

export function recClass(rec) {
  if (rec === "Museum Candidate") return "bb-rec-museum";
  if (rec?.includes("Sell")) return "bb-rec-sell";
  if (rec?.includes("Lot") || rec?.includes("Verify")) return "bb-rec-lot";
  if (rec?.includes("Investment")) return "bb-rec-invest";
  return "bb-rec-review";
}

export function formatCell(colId, value) {
  if (colId === "Live Range") {
    return value || "not fetched";
  }
  if (colId === "Inventory Bucket") {
    return bucketShort(value);
  }
  if (colId === "Current Price") {
    const n = Number(value) || 0;
    return n > 0 ? `$${n.toFixed(2)}` : "—";
  }
  if (["Museum Score", "Investment Score", "Liquidity Score"].includes(colId)) {
    return String(Math.round(Number(value) || 0));
  }
  return value || "—";
}

export function buildTickerItems(rows, meta, limit = 24) {
  const byValue = [...rows].sort((a, b) => (b["Current Price"] || 0) - (a["Current Price"] || 0));
  const museum = rows.filter((r) => r.Recommendation === "Museum Candidate");
  const liq = rows.filter((r) => isHighLiquidity(r, 70)).slice(0, 6);

  const picks = [
    { type: "stat", text: `VAULT ${fmtMoney(meta?.totalValue)}` },
    { type: "stat", text: `${meta?.recordCount ?? 0} ISSUES` },
    { type: "stat", text: `MUS ${meta?.museumCandidates ?? 0}` },
    { type: "stat", text: `LIQ MOVE ${rows.filter((r) => isHighLiquidity(r, 65)).length}` },
    ...byValue.slice(0, 5).map((c) => ({ type: "comic", text: comicTicker(c) })),
    ...museum.slice(0, 3).map((c) => ({ type: "museum", text: `★ ${comicTicker(c)}` })),
    ...liq.slice(0, 4).map((c) => ({ type: "liquidity", text: `⚡ ${comicTicker(c)}` })),
  ];

  return picks.slice(0, limit);
}

export function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function bucketShort(name) {
  switch (name) {
    case "personal_collection":
      return "Personal";
    case "investment_vault":
      return "Invest";
    case "dealer_inventory":
      return "Dealer";
    default:
      return name || "—";
  }
}

export function pillarShort(name) {
  return name
    .replace("Good Girl / Risqué Covers", "Risqué")
    .replace("Cover Art & Favorite Artists", "Cover Art")
    .replace("Bronze & Silver Age Keys", "Bronze/Silver")
    .replace("First Appearances", "1st Apps")
    .replace("Investment Portfolio", "Invest")
    .replace("General Inventory", "General ⚠")
    .replace("Absolute Universe", "Absolute");
}

export const PILLAR_COLORS = {
  "General Inventory": "#888",
  Batman: "#4da6ff",
  "Spider-Man": "#f87171",
  "X-Men": "#fbbf24",
  Superman: "#60a5fa",
  "Absolute Universe": "#a78bfa",
  "First Appearances": "#34d399",
  "Cover Art & Favorite Artists": "#f472b6",
  "Sci-Fi": "#22d3ee",
  "Bronze & Silver Age Keys": "#fb923c",
  "Investment Portfolio": "#ff9900",
  "Good Girl / Risqué Covers": "#e879f9",
  "Personal Favorites": "#c084fc",
};

export function pillarColor(name) {
  return PILLAR_COLORS[name] ?? "#666";
}
