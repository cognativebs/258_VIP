// Absolute Batman Master Hunt — seeded from IQVault_Collection_Hunt_Absolute_Batman_Master_Workbook.md

function item(id, name, opts = {}) {
  return {
    id,
    name,
    status: opts.status ?? "missing",
    grade: opts.grade ?? null,
    paid: opts.paid ?? null,
    market: opts.market ?? null,
    buyUnder: opts.buyUnder ?? null,
    priority: opts.priority ?? "medium",
    notes: opts.notes ?? null,
    coverArtist: opts.coverArtist ?? null,
    assetId: opts.assetId ?? null,
    keyIssue: opts.keyIssue ?? false,
  };
}

const PRELUDE = [
  item("prelude-cover-a", "Cover A", { status: "wanted", buyUnder: 8, market: 12, priority: "high", keyIssue: true }),
  item("prelude-foil", "Foil", { status: "missing", buyUnder: 15, market: 22 }),
  item("prelude-blank", "Blank", { status: "missing", buyUnder: 25, market: 35 }),
  item("prelude-incentives", "Incentives (optional)", { status: "missing", priority: "low" }),
];

const CORE_RUN = [
  item("core-1", "#1 — Cover A (1st Print)", {
    status: "owned",
    grade: "Raw NM",
    paid: 14.99,
    market: 12.5,
    buyUnder: 10,
    priority: "high",
    coverArtist: "Nick Dragotta",
    assetId: "a5-comic-batman-1a",
    keyIssue: true,
  }),
  item("core-2", "#2 — Cover A (1st Print)", { status: "wanted", buyUnder: 5, market: 7.5, priority: "high" }),
  item("core-3", "#3 — Cover A (1st Print)", { status: "missing", buyUnder: 5, market: 6.5 }),
  item("core-4", "#4 — Cover A (1st Print)", { status: "missing", buyUnder: 5, market: 6.0 }),
  item("core-5", "#5 — Cover A (1st Print)", { status: "missing", buyUnder: 5, market: 5.5 }),
  item("core-6", "#6 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 5.0 }),
  item("core-7", "#7 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.5 }),
  item("core-8", "#8 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.5 }),
  item("core-9", "#9 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-10", "#10 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-11", "#11 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-12", "#12 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-13", "#13 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-14", "#14 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-15", "#15 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-16", "#16 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-17", "#17 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-18", "#18 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-19", "#19 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
  item("core-20", "#20 — Cover A (1st Print)", { status: "missing", buyUnder: 4, market: 4.0 }),
];

const FIRST_PRINT_VARIANTS = [
  item("var-cover-a", "Cover A", { status: "owned", grade: "Raw NM", paid: 14.99, market: 12.5, coverArtist: "Nick Dragotta", assetId: "a5-comic-batman-1a", keyIssue: true }),
  item("var-cover-b", "Cover B", { status: "wanted", buyUnder: 8, market: 11, priority: "high", coverArtist: "Frank Miller" }),
  item("var-cover-c", "Cover C", { status: "missing", buyUnder: 8, market: 10, coverArtist: "Jim Lee" }),
  item("var-cover-d", "Cover D", { status: "missing", buyUnder: 8, market: 9, coverArtist: "Scott Snyder" }),
  item("var-blank-sketch", "Blank Sketch", { status: "missing", buyUnder: 20, market: 28 }),
  item("var-logo-foil", "Logo Foil", { status: "missing", buyUnder: 15, market: 22 }),
  item("var-jim-lee-foil", "Jim Lee Foil", { status: "missing", buyUnder: 25, market: 38, priority: "high" }),
  item("var-dragotta-foil", "Dragotta Foil", { status: "missing", buyUnder: 18, market: 26 }),
  item("var-1-25", "1:25 Variant", { status: "missing", buyUnder: 45, market: 65, priority: "high" }),
  item("var-1-50", "1:50 Variant", { status: "missing", buyUnder: 75, market: 110 }),
  item("var-1-100", "1:100 Variant", { status: "missing", buyUnder: 120, market: 175 }),
  item("var-retailer-exclusives", "Retailer Exclusives", { status: "missing", priority: "medium" }),
  item("var-convention-exclusives", "Convention Exclusives", { status: "missing", priority: "medium" }),
];

const PRINTINGS = [
  item("print-1", "1st Printing", { status: "owned", grade: "Raw NM", paid: 14.99, market: 12.5, assetId: "a5-comic-batman-1a" }),
  item("print-2", "2nd Printing", { status: "missing", buyUnder: 6, market: 8 }),
  item("print-3", "3rd Printing", { status: "owned", grade: "Raw NM", paid: 6.99, market: 5.0, assetId: "a5-comic-batman-1a-p3" }),
  item("print-4", "4th Printing", { status: "missing", buyUnder: 4, market: 5 }),
  item("print-5", "5th Printing", { status: "missing", buyUnder: 4, market: 4.5 }),
  item("print-6", "6th Printing", { status: "missing", buyUnder: 3, market: 4 }),
  item("print-7", "7th Printing", { status: "missing", buyUnder: 3, market: 4 }),
  item("print-8", "8th Printing", { status: "missing", buyUnder: 3, market: 3.5 }),
  item("print-9", "9th Printing", { status: "missing", buyUnder: 3, market: 3.5 }),
  item("print-10", "10th Printing", { status: "missing", buyUnder: 3, market: 3 }),
  item("print-11", "11th Printing", { status: "missing", buyUnder: 3, market: 3 }),
];

const RETAILER_EXCLUSIVES = [
  item("excl-tfa", "The Final Boss Comics Exclusive", { status: "missing", buyUnder: 30, market: 45, notes: "Convention variant" }),
  item("excl-unknown", "Additional exclusives (TBD)", { status: "missing", priority: "low", notes: "Track as announced" }),
];

export const absoluteBatmanHunt = {
  id: "absolute-batman-master",
  name: "Absolute Batman Master Hunt",
  category: "comic",
  status: "active",
  icon: "🦇",
  color: "#ef4444",
  budget: 2500,
  priority: "high",
  description:
    "Complete Absolute Batman #1–20 (1st Print Cover A), all #1 first-print variants, all printings, and DC All In Special #1.",
  objectives: [
    "Complete Absolute Batman #1–20 (1st Print Cover A)",
    "Collect ALL first-print variants of Absolute Batman #1",
    "Collect ALL subsequent printings of Absolute Batman #1",
    "Collect DC All In Special #1",
  ],
  sections: [
    { id: "prelude", name: "Prelude — DC All In Special #1", metricKey: "prelude", items: PRELUDE },
    { id: "core-run", name: "Core Run — #1–20 (Cover A, 1st Print)", metricKey: "coreRun", items: CORE_RUN },
    { id: "variants", name: "#1 First Print Variants", metricKey: "variants", items: FIRST_PRINT_VARIANTS },
    { id: "printings", name: "#1 Subsequent Printings", metricKey: "printings", items: PRINTINGS },
    { id: "exclusives", name: "Retailer / Convention Exclusives", metricKey: "exclusives", items: RETAILER_EXCLUSIVES },
  ],
  recommendations: [
    {
      item: "Absolute Batman #2 — Cover A (1st Print)",
      confidence: 0.88,
      reason: "Core run gap — lowest cost next step toward #1–20 completion",
      estimatedRoi: "Hold",
      completionImpact: "+5% Core Run",
      buyUnder: 5,
    },
    {
      item: "DC All In Special #1 — Cover A",
      confidence: 0.82,
      reason: "First Absolute Batman appearance — prelude to the hunt",
      estimatedRoi: "Speculative",
      completionImpact: "+25% Prelude",
      buyUnder: 8,
    },
    {
      item: "Absolute Batman #1 — Cover B (1st Print)",
      confidence: 0.75,
      reason: "High-priority variant; market softening — buy-under window open",
      estimatedRoi: "Hold",
      completionImpact: "+8% Variants",
      buyUnder: 8,
    },
  ],
  signals: [
    { type: "market", text: "1st printing Cover A down 18% over 30d — patience rewarded on reprints", date: "2026-06-28" },
    { type: "news", text: "Absolute Universe expanding — film/TV speculation driving variant demand", date: "2026-06-15" },
    { type: "supply", text: "4th–6th printings flooding LCS shelves — printings 7+ still scarce", date: "2026-06-01" },
  ],
};
