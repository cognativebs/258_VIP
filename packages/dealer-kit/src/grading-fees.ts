import type { Grader, GradingFeeTier, ServiceLane } from "./schemas.js";

/**
 * Published 2026 fee schedules — operator must confirm at checkout.
 * Sources: PSA services page + Sept 2026 Standard launch notes;
 * CGC Jan/Mar 2026 fee updates; BGS mid-2026 public schedule.
 * Status flags matter: several cheap tiers were paused.
 */
export const GRADING_FEE_AS_OF = "2026-09-13";

export const GRADING_FEE_TIERS: GradingFeeTier[] = [
  // PSA cards
  {
    id: "psa-cards-value-bulk",
    grader: "PSA",
    category: "cards",
    name: "Value Bulk",
    lane: "bulk",
    feeUsd: 24.99,
    turnaroundBusinessDays: 100,
    maxInsuredValueUsd: 500,
    minQty: 20,
    status: "paused",
    notes: "Collectors Club; paused as of Sept 2026. Kept so the dropdown still models bulk.",
  },
  {
    id: "psa-cards-value",
    grader: "PSA",
    category: "cards",
    name: "Value",
    lane: "value",
    feeUsd: 32.99,
    turnaroundBusinessDays: 80,
    maxInsuredValueUsd: 500,
    minQty: 1,
    status: "paused",
    notes: "Paused Sept 2026. Do not assume you can submit at this fee.",
  },
  {
    id: "psa-cards-standard",
    grader: "PSA",
    category: "cards",
    name: "Standard",
    lane: "value",
    feeUsd: 59.99,
    turnaroundBusinessDays: 95,
    maxInsuredValueUsd: 1000,
    minQty: 1,
    status: "active",
    notes: "Opens 2026-09-14. $1,000 MIV cap — the usual trap on 'cheap' tiers.",
  },
  {
    id: "psa-cards-priority",
    grader: "PSA",
    category: "cards",
    name: "Priority (ex Regular)",
    lane: "value",
    feeUsd: 79.99,
    turnaroundBusinessDays: 75,
    maxInsuredValueUsd: 1500,
    minQty: 1,
    status: "active",
    notes: "Renamed from Regular. Confirm live at checkout.",
  },
  {
    id: "psa-cards-express",
    grader: "PSA",
    category: "cards",
    name: "Express",
    lane: "express",
    feeUsd: 199,
    turnaroundBusinessDays: 25,
    maxInsuredValueUsd: 2500,
    minQty: 1,
    status: "active",
    notes: "Raised from $149 on 2026-09-09.",
  },
  {
    id: "psa-cards-premier",
    grader: "PSA",
    category: "cards",
    name: "Premier (ex Walk-Through)",
    lane: "express",
    feeUsd: 599,
    turnaroundBusinessDays: 8,
    maxInsuredValueUsd: 10000,
    minQty: 1,
    status: "active",
    notes: "Only for cards that already clear four-figure raw.",
  },
  // CGC cards
  {
    id: "cgc-cards-bulk",
    grader: "CGC",
    category: "cards",
    name: "Bulk",
    lane: "bulk",
    feeUsd: 17,
    turnaroundBusinessDays: 150,
    maxInsuredValueUsd: 500,
    minQty: 25,
    status: "active",
    notes: "Mar 2026 update ($15 → $17). Effective min submission $425.",
  },
  {
    id: "cgc-cards-economy",
    grader: "CGC",
    category: "cards",
    name: "Economy",
    lane: "value",
    feeUsd: 20,
    turnaroundBusinessDays: 90,
    maxInsuredValueUsd: 1000,
    minQty: 1,
    status: "active",
    notes: "Mar 2026 ($18 → $20).",
  },
  {
    id: "cgc-cards-standard",
    grader: "CGC",
    category: "cards",
    name: "Standard",
    lane: "value",
    feeUsd: 55,
    turnaroundBusinessDays: 10,
    maxInsuredValueUsd: 3000,
    minQty: 1,
    status: "active",
    notes: "Best mid-value speed/cost mix on the 2026 card schedule.",
  },
  {
    id: "cgc-cards-express",
    grader: "CGC",
    category: "cards",
    name: "Express",
    lane: "express",
    feeUsd: 100,
    turnaroundBusinessDays: 5,
    maxInsuredValueUsd: 10000,
    minQty: 1,
    status: "active",
    notes: "Jan 2026 fee card.",
  },
  // CGC comics
  {
    id: "cgc-comics-modern-bulk",
    grader: "CGC",
    category: "comics",
    name: "Modern Bulk",
    lane: "bulk",
    feeUsd: 27,
    turnaroundBusinessDays: 60,
    maxInsuredValueUsd: 400,
    minQty: 25,
    status: "active",
    notes: "Jan 6 2026. Modern-era books only.",
  },
  {
    id: "cgc-comics-modern",
    grader: "CGC",
    category: "comics",
    name: "Modern",
    lane: "value",
    feeUsd: 30,
    turnaroundBusinessDays: 30,
    maxInsuredValueUsd: 400,
    minQty: 1,
    status: "active",
    notes: "Jan 6 2026 ($27-era bulk vs $30 single).",
  },
  {
    id: "cgc-comics-vintage",
    grader: "CGC",
    category: "comics",
    name: "Vintage",
    lane: "value",
    feeUsd: 45,
    turnaroundBusinessDays: 30,
    maxInsuredValueUsd: 400,
    minQty: 1,
    status: "active",
    notes: "Jan 6 2026.",
  },
  {
    id: "cgc-comics-high-value",
    grader: "CGC",
    category: "comics",
    name: "High Value",
    lane: "express",
    feeUsd: 105,
    turnaroundBusinessDays: 15,
    maxInsuredValueUsd: 10000,
    minQty: 1,
    status: "active",
    notes: "Jan 6 2026. Use when FMV already clears four figures.",
  },
  // BGS cards
  {
    id: "bgs-cards-base",
    grader: "BGS",
    category: "cards",
    name: "Base (no subgrades)",
    lane: "bulk",
    feeUsd: 14.95,
    turnaroundBusinessDays: 75,
    maxInsuredValueUsd: null,
    minQty: 1,
    status: "paused",
    notes: "Public mid-2026 list; multiple sources mark Base/Standard paused. $3 upcharge if it 10s.",
  },
  {
    id: "bgs-cards-standard",
    grader: "BGS",
    category: "cards",
    name: "Standard (subgrades)",
    lane: "value",
    feeUsd: 34.95,
    turnaroundBusinessDays: 45,
    maxInsuredValueUsd: null,
    minQty: 1,
    status: "paused",
    notes: "Paused on several 2026 snapshots. Confirm before modeling as live.",
  },
  {
    id: "bgs-cards-express",
    grader: "BGS",
    category: "cards",
    name: "Express",
    lane: "express",
    feeUsd: 79.95,
    turnaroundBusinessDays: 15,
    maxInsuredValueUsd: null,
    minQty: 1,
    status: "active",
    notes: "Includes subgrades. Often the only live BGS lane.",
  },
  {
    id: "bgs-cards-priority",
    grader: "BGS",
    category: "cards",
    name: "Priority",
    lane: "express",
    feeUsd: 124.95,
    turnaroundBusinessDays: 5,
    maxInsuredValueUsd: null,
    minQty: 1,
    status: "active",
    notes: "Includes subgrades.",
  },
];

export function listTiers(filter?: {
  grader?: Grader;
  category?: "cards" | "comics";
  lane?: ServiceLane;
  includePaused?: boolean;
}): GradingFeeTier[] {
  return GRADING_FEE_TIERS.filter((t) => {
    if (filter?.grader && t.grader !== filter.grader) return false;
    if (filter?.category && t.category !== filter.category) return false;
    if (filter?.lane && t.lane !== filter.lane) return false;
    if (!filter?.includePaused && t.status === "paused") return false;
    return true;
  });
}

export function resolveTier(input: {
  grader: Grader;
  category: "cards" | "comics";
  tierId?: string;
  lane?: ServiceLane;
  includePaused?: boolean;
}): GradingFeeTier {
  if (input.tierId) {
    const found = GRADING_FEE_TIERS.find((t) => t.id === input.tierId);
    if (!found) throw new Error(`Unknown grading tier ${input.tierId}`);
    return found;
  }
  const pool = listTiers({
    grader: input.grader,
    category: input.category,
    lane: input.lane,
    includePaused: input.includePaused,
  });
  if (pool[0]) return pool[0];
  const any = listTiers({ grader: input.grader, category: input.category, includePaused: true });
  if (!any[0]) throw new Error(`No fee tier for ${input.grader} ${input.category}`);
  return any[0];
}
