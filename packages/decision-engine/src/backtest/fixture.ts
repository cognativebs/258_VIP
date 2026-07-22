import { z } from "zod";
import {
  DecisionInputSchema,
  EngineStanceSchema,
  type DecisionInput,
  type EngineStance,
} from "../types.js";

/**
 * Historical decision fixture for Phase 2 gate.
 * Replace/extend with your real past calls — structure stays stable.
 */
export const HistoricalDecisionSchema = z.object({
  id: z.string(),
  label: z.string(),
  input: DecisionInputSchema,
  /** What you actually decided at the time. */
  actualStance: EngineStanceSchema,
  /** Outcome after the fact. */
  outcome: z.enum(["good", "bad", "mixed", "unknown"]),
  outcomeNotes: z.string().optional(),
});
export type HistoricalDecision = {
  id: string;
  label: string;
  input: DecisionInput;
  actualStance: EngineStance;
  outcome: "good" | "bad" | "mixed" | "unknown";
  outcomeNotes?: string;
};

function daysAgo(n: number, asOf = new Date("2026-07-01T12:00:00Z")): Date {
  return new Date(asOf.getTime() - n * 86400000);
}

const asOf = new Date("2026-07-01T12:00:00Z");

function sales(
  idPrefix: string,
  prices: { price: number; daysAgo: number; source?: string }[],
) {
  return prices.map((p, i) => ({
    id: `${idPrefix}-${i + 1}`,
    price: p.price,
    saleDate: daysAgo(p.daysAgo, asOf),
    source: p.source ?? "ebay",
  }));
}

export const HISTORICAL_DECISIONS: HistoricalDecision[] = [
  {
    id: "h01",
    label: "Absolute Batman #1 Cover A — clear under-comp ask",
    input: {
      assetId: "asset-ab-1a",
      assetName: "Absolute Batman #1 Cover A",
      askPrice: 18,
      asOf,
      windowDays: 90,
      sales: sales("ab1", [
        { price: 22, daysAgo: 5 },
        { price: 24, daysAgo: 12 },
        { price: 20, daysAgo: 20 },
        { price: 25, daysAgo: 35 },
        { price: 21, daysAgo: 40 },
      ]),
      collectionFit: { inHunt: true, huntSlug: "absolute-batman", isDuplicate: false },
      constraints: {
        budget: 50,
        riskTolerance: "medium",
        collectionGoals: ["Absolute Universe"],
        premiumTolerance: 0.05,
      },
    },
    actualStance: "Buy",
    outcome: "good",
    outcomeNotes: "Bought; later comps held mid-$20s.",
  },
  {
    id: "h02",
    label: "Absolute Batman #1 Cover A — ask above high",
    input: {
      assetId: "asset-ab-1a-over",
      assetName: "Absolute Batman #1 Cover A",
      askPrice: 45,
      asOf,
      sales: sales("ab1o", [
        { price: 22, daysAgo: 5 },
        { price: 24, daysAgo: 12 },
        { price: 20, daysAgo: 20 },
        { price: 25, daysAgo: 35 },
      ]),
      collectionFit: { inHunt: true, huntSlug: "absolute-batman", isDuplicate: false },
      constraints: { budget: 50, riskTolerance: "medium", collectionGoals: ["Absolute Universe"] },
    },
    actualStance: "Pass",
    outcome: "good",
    outcomeNotes: "Passed; avoided overpay.",
  },
  {
    id: "h03",
    label: "Thin-comp variant — should Watch/Pass not Buy",
    input: {
      assetId: "asset-thin",
      assetName: "Absolute Batman #3 Virgin exclusive",
      askPrice: 80,
      asOf,
      sales: sales("thin", [{ price: 90, daysAgo: 60 }]),
      collectionFit: { inHunt: true, huntSlug: "absolute-batman", isDuplicate: false },
      constraints: { budget: 120, riskTolerance: "low", collectionGoals: ["Absolute Universe"] },
    },
    actualStance: "Watch",
    outcome: "good",
    outcomeNotes: "Waited; better copy appeared later.",
  },
  {
    id: "h04",
    label: "Duplicate raw — should not Buy",
    input: {
      assetId: "asset-dup",
      assetName: "Amazing Spider-Man #300",
      askPrice: 40,
      asOf,
      sales: sales("asm", [
        { price: 55, daysAgo: 8 },
        { price: 50, daysAgo: 15 },
        { price: 48, daysAgo: 22 },
        { price: 52, daysAgo: 30 },
      ]),
      collectionFit: { inHunt: false, isDuplicate: true, pillar: "Spider-Man" },
      constraints: { budget: 100, riskTolerance: "medium", collectionGoals: ["Spider-Man"] },
    },
    actualStance: "Pass",
    outcome: "good",
    outcomeNotes: "Already owned; passing was correct.",
  },
  {
    id: "h05",
    label: "Over budget even if comps look fine",
    input: {
      assetId: "asset-budget",
      assetName: "Pokémon 151 Booster Bundle",
      askPrice: 95,
      asOf,
      sales: sales("pkmn", [
        { price: 100, daysAgo: 3 },
        { price: 98, daysAgo: 10 },
        { price: 102, daysAgo: 18 },
        { price: 96, daysAgo: 25 },
      ]),
      collectionFit: { inHunt: true, huntSlug: "pokemon-30th", isDuplicate: false },
      constraints: { budget: 60, riskTolerance: "high", collectionGoals: ["Pokémon"] },
    },
    actualStance: "Pass",
    outcome: "good",
    outcomeNotes: "Budget discipline held.",
  },
  {
    id: "h06",
    label: "In-band ask — Watch not Buy",
    input: {
      assetId: "asset-band",
      assetName: "Absolute Superman #1 Cover A",
      askPrice: 14,
      asOf,
      sales: sales("asup", [
        { price: 12, daysAgo: 4 },
        { price: 15, daysAgo: 11 },
        { price: 13, daysAgo: 19 },
        { price: 14, daysAgo: 28 },
      ]),
      collectionFit: { inHunt: true, huntSlug: "absolute-universe", isDuplicate: false },
      constraints: { budget: 40, riskTolerance: "medium", collectionGoals: ["Absolute Universe"] },
    },
    actualStance: "Watch",
    outcome: "mixed",
    outcomeNotes: "Fair price; buying was optional.",
  },
  {
    id: "h07",
    label: "Bad call historically — bought above high",
    input: {
      assetId: "asset-bad-buy",
      assetName: "Weapons of Mutant Destruction: Alpha",
      askPrice: 35,
      asOf,
      sales: sales("womd", [
        { price: 12, daysAgo: 6 },
        { price: 14, daysAgo: 14 },
        { price: 11, daysAgo: 21 },
        { price: 13, daysAgo: 33 },
      ]),
      collectionFit: { inHunt: false, isDuplicate: false, pillar: "X-Men" },
      constraints: { budget: 50, riskTolerance: "high", collectionGoals: ["X-Men"] },
    },
    actualStance: "Buy",
    outcome: "bad",
    outcomeNotes: "Overpaid vs comps — engine should Pass/Watch and flag disagreement.",
  },
  {
    id: "h08",
    label: "Illiquid key — low risk should Watch",
    input: {
      assetId: "asset-illiquid",
      assetName: "Bronze Age key (thin market)",
      askPrice: 200,
      asOf,
      sales: sales("bronze", [
        { price: 250, daysAgo: 70 },
        { price: 240, daysAgo: 85 },
      ]),
      collectionFit: { inHunt: false, isDuplicate: false, pillar: "Bronze & Silver Age Keys" },
      constraints: {
        budget: 300,
        riskTolerance: "low",
        collectionGoals: ["Bronze & Silver Age Keys"],
        premiumTolerance: 0,
      },
    },
    actualStance: "Watch",
    outcome: "good",
    outcomeNotes: "Correct patience on thin market.",
  },
  {
    id: "h09",
    label: "Strong discount + hunt fit → Buy",
    input: {
      assetId: "asset-hunt-buy",
      assetName: "Absolute Batman #2 Cover A",
      askPrice: 8,
      asOf,
      sales: sales("ab2", [
        { price: 12, daysAgo: 2 },
        { price: 11, daysAgo: 9 },
        { price: 13, daysAgo: 16 },
        { price: 12, daysAgo: 24 },
        { price: 14, daysAgo: 31 },
      ]),
      collectionFit: { inHunt: true, huntSlug: "absolute-batman", isDuplicate: false },
      constraints: { budget: 25, riskTolerance: "medium", collectionGoals: ["Absolute Universe"] },
    },
    actualStance: "Buy",
    outcome: "good",
  },
  {
    id: "h10",
    label: "No comps at all → Pass/Watch",
    input: {
      assetId: "asset-nocomps",
      assetName: "Obscure convention exclusive",
      askPrice: 60,
      asOf,
      sales: [],
      collectionFit: { inHunt: false, isDuplicate: false },
      constraints: { budget: 100, riskTolerance: "medium", collectionGoals: [] },
    },
    actualStance: "Pass",
    outcome: "good",
    outcomeNotes: "No evidence — correctly refused fake precision Buy.",
  },
];

export function loadHistoricalDecisions(
  rows: unknown[] = HISTORICAL_DECISIONS,
): HistoricalDecision[] {
  return rows.map((r) => HistoricalDecisionSchema.parse(r));
}
