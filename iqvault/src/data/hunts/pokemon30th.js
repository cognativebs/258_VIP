// Pokémon 30th Celebration Hunt — built from Pokemon30 Intelligence Run 001

import { getLatestPokemon30Run, mapPriority } from "../intelligence/pokemon30/index.js";

function product(id, name, opts = {}) {
  return {
    id,
    name,
    status: opts.status ?? "missing",
    productType: opts.productType ?? "sealed",
    msrp: opts.msrp ?? null,
    paid: opts.paid ?? null,
    market: opts.market ?? null,
    buyUnder: opts.buyUnder ?? null,
    emergencyCap: opts.emergencyCap ?? null,
    targetQty: opts.targetQty ?? null,
    priority: opts.priority ?? "medium",
    priorityLabel: opts.priorityLabel ?? null,
    notes: opts.notes ?? null,
    retailer: opts.retailer ?? null,
    releaseYear: opts.releaseYear ?? 2026,
  };
}

function productFromRun(p) {
  const action = p.action.replace(/_/g, " ");
  const notes = [
    `Target qty: ${p.target_qty}`,
    `Action: ${action}`,
    p.emergency_cap ? `Emergency cap: $${p.emergency_cap}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return product(p.id, p.name, {
    status: "wanted",
    productType: p.product_type,
    msrp: p.msrp ?? null,
    buyUnder: p.buy_under,
    emergencyCap: p.emergency_cap ?? null,
    targetQty: p.target_qty,
    priority: mapPriority(p.priority),
    priorityLabel: p.priority,
    notes,
    releaseYear: 2026,
  });
}

const run = getLatestPokemon30Run();

const CURRENT_HOLDINGS = [
  product("hold-destined-rivals-bb", "Destined Rivals Booster Box", {
    status: "owned",
    productType: "booster_box",
    paid: 144.99,
    market: 168,
    priority: "high",
    releaseYear: 2025,
  }),
  product("hold-chaos-rising-bb", "Chaos Rising Booster Box", {
    status: "owned",
    productType: "booster_box",
    paid: 139.99,
    market: 155,
    priority: "high",
    releaseYear: 2025,
  }),
  product("hold-perfect-order-pc-etb", "Perfect Order Pokémon Center ETB", {
    status: "owned",
    productType: "pc_etb",
    paid: 59.99,
    market: 95,
    msrp: 59.99,
    priority: "high",
    retailer: "Pokémon Center",
    releaseYear: 2026,
  }),
];

const LAUNCH_TARGETS = run.products
  .filter((p) => ["S", "A+", "A"].includes(p.priority))
  .map(productFromRun);

const OPPORTUNISTIC = run.products
  .filter((p) => p.priority === "B")
  .map(productFromRun);

export const pokemon30thHunt = {
  id: "pokemon-30th-anniversary",
  name: "Pokémon 30th Celebration",
  category: "pokemon",
  status: "active",
  icon: "⚡",
  color: "#fbbf24",
  budget: run.user_profile.budget_usd,
  priority: "critical",
  releaseDate: run.release_date,
  description: run.executive_summary,
  intelligenceRun: run,
  objectives: [
    "Secure up to 4 Pokémon Center ETBs (buy under $90 / emergency $110)",
    "Acquire Day/Espeon and Night/Umbreon UPCs at MSRP",
    "Buy 8–12 Booster Bundles at MSRP or low premium",
    "Maintain $400–700 cash reserve for restocks and missed drops",
  ],
  strategy: {
    focus: `Maximum ROI · $${run.user_profile.budget_usd} budget · MSRP-first with controlled premiums on PC ETB & UPC only`,
    buyRules: [
      "Pokémon Center ETB — up to 4",
      "UPCs (Espeon + Umbreon) — up to 2 each at MSRP",
      "Booster Bundles — 8–12 at MSRP",
      "Regular ETB — fallback only, max 2",
    ],
    avoidRules: [
      "Poster / Tech Sticker / Knock Out collections",
      "Mini tins, battle decks, sticker collections",
      "Regular ex boxes unless demand spikes",
      "Marketplace sellers on Walmart/Amazon",
    ],
  },
  sections: [
    { id: "holdings", name: "Current Holdings", metricKey: "holdings", items: CURRENT_HOLDINGS },
    { id: "launch", name: "30th Celebration — Launch Targets", metricKey: "launch", items: LAUNCH_TARGETS },
    { id: "opportunistic", name: "Opportunistic — If Budget Allows", metricKey: "opportunistic", items: OPPORTUNISTIC },
  ],
  retailers: run.retailers.map((r) => ({
    name: r.name,
    priority: r.priority,
    status: r.status.replace(/_/g, " "),
    action: r.action.replace(/_/g, " "),
    role: r.role.replace(/_/g, " "),
  })),
  recommendations: run.predictions.slice(0, 3).map((p) => ({
    item: p.prediction,
    confidence: p.probability,
    reason: p.action.replace(/_/g, " "),
    estimatedRoi: "Run 001 intel",
    completionImpact: `${(p.probability * 100).toFixed(0)}% confidence`,
    buyUnder: null,
  })),
  signals: run.signals,
};
