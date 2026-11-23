import { z } from "zod";
import { apiGet, apiPost } from "@/lib/api";
import type { ConfidenceWord, ValueRangeProps } from "../schemas";

/**
 * OPERATE → Sell reads GET /api/sell-queue/dogfood: top-N decision-engine
 * advice with a provenance block per item. The web copy of the contract is
 * narrower than the API's strict schema (unknown keys pass) so an additive API
 * change does not blank the section.
 */
export const SELL_TOP_N = 20;
const SELL_READ_MS = 90_000;

const bandSchema = z.enum(["low", "medium", "high"]);

export const sellAdviceItemSchema = z.object({
  holdingId: z.string(),
  assetName: z.string(),
  sellPriority: z.string().nullable(),
  action: z.enum(["Buy", "Hold", "Grade", "Sell", "Lot", "Pass"]),
  confidence: z.number().min(0).max(1),
  confidenceBand: bandSchema,
  reasons: z.array(z.string()),
  marketRange: z
    .object({
      low: z.number(),
      high: z.number(),
      matchedSales: z.number(),
      recencyDays: z.number().nullable(),
      confidenceBand: bandSchema,
    })
    .nullable(),
  insufficientMarketEvidence: z.boolean(),
  isStale: z.boolean(),
  gradingRecommendation: z.string(),
  provenance: z.object({
    source: z.string(),
    method: z.string(),
    ruleOrModelVersion: z.string(),
    confidence: z.number(),
    verificationStatus: z.string(),
    evidenceCount: z.number(),
    recencyDays: z.number().nullable(),
    minSalesRequired: z.number(),
  }),
  /** Q16: newest operator mark; absent when the API did not load marks. */
  latestDecision: z
    .object({
      decision: z.enum(["accepted", "rejected"]),
      action: z.string(),
      reason: z.string().nullable(),
      decidedAt: z.string(),
    })
    .nullable()
    .optional(),
});

export const sellAdviceResponseSchema = z.object({
  note: z.string(),
  limit: z.number(),
  count: z.number(),
  gradingCost: z.object({ usd: z.number(), source: z.string(), note: z.string() }),
  operatorMarks: z.string(),
  items: z.array(sellAdviceItemSchema),
});
export type SellAdviceResponse = z.infer<typeof sellAdviceResponseSchema>;

export type SellAdviceModel = {
  id: string;
  name: string;
  action: string;
  confidencePercent: number;
  confidence: ConfidenceWord;
  priority: string | null;
  /** null → "Insufficient market evidence"; never a guessed range. */
  range: ValueRangeProps | null;
  insufficient: boolean;
  stale: boolean;
  reasons: string[];
  provenance: string;
  /** Advice as shown — sent with a mark so the log keeps what was decided on. */
  confidenceRaw: number;
  ruleOrModelVersion: string;
  mark: { decision: "accepted" | "rejected"; action: string; reason: string | null; decidedAt: string } | null;
};

export type SellModel = {
  error: string | null;
  note: string | null;
  assumption: string | null;
  marksNote: string | null;
  /** True when the decision log answered, so Accept / Reject can be offered. */
  marksEnabled?: boolean;
  items: SellAdviceModel[];
};

/** Q16: append an accept / reject mark. It changes no holding or listing. */
export async function recordSellMark(
  item: Pick<SellAdviceModel, "id" | "action" | "confidenceRaw" | "ruleOrModelVersion">,
  decision: "accepted" | "rejected",
  reason?: string,
): Promise<{ decision: "accepted" | "rejected"; action: string; reason: string | null; decidedAt: string }> {
  const res = await apiPost<{
    decision: { decision: "accepted" | "rejected"; action: string; reason: string | null; decidedAt: string };
  }>("/api/sell-queue/decisions", {
    holdingId: item.id,
    decision,
    action: item.action,
    confidence: item.confidenceRaw,
    ruleOrModelVersion: item.ruleOrModelVersion,
    ...(reason && reason.trim() ? { reason: reason.trim() } : {}),
  });
  return {
    decision: res.decision.decision,
    action: res.decision.action,
    reason: res.decision.reason,
    decidedAt: res.decision.decidedAt,
  };
}

export function sellModelFromResponse(raw: unknown): SellModel {
  const parsed = sellAdviceResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "The sell queue response did not match its contract.", note: null, assumption: null, marksNote: null, items: [] };
  }
  const data = parsed.data;
  return {
    error: null,
    note: data.note,
    assumption: `Grading cost ${data.gradingCost.usd} USD per book · ${data.gradingCost.note}`,
    marksNote:
      data.operatorMarks === "recorded"
        ? null
        : data.operatorMarks === "unavailable"
          ? "Accept / reject marks could not be read right now."
          : "Accept / reject is not recorded yet. Act on a row in Listings or the comics terminal.",
    marksEnabled: data.operatorMarks === "recorded",
    items: data.items.map((item) => {
      const range = item.marketRange && item.marketRange.matchedSales > 0 ? item.marketRange : null;
      return {
        id: item.holdingId,
        name: item.assetName,
        action: item.action,
        confidencePercent: Math.round(item.confidence * 100),
        confidence: item.confidenceBand,
        priority: item.sellPriority,
        insufficient: item.insufficientMarketEvidence || !range,
        stale: item.isStale,
        range: range
          ? {
              low: range.low,
              high: range.high,
              compCount: range.matchedSales,
              recencyDays: range.recencyDays,
              confidence: range.confidenceBand,
              evidenceLabel: "comps",
            }
          : null,
        reasons: item.reasons,
        confidenceRaw: item.confidence,
        ruleOrModelVersion: item.provenance.ruleOrModelVersion,
        mark: item.latestDecision ?? null,
        provenance: [
          item.provenance.source,
          item.provenance.method,
          item.provenance.ruleOrModelVersion,
          `${item.provenance.evidenceCount}/${item.provenance.minSalesRequired} comps`,
          item.provenance.recencyDays == null ? "recency unknown" : `${Math.round(item.provenance.recencyDays)}d`,
          item.provenance.verificationStatus,
        ].join(" · "),
      };
    }),
  };
}

export async function loadSellAdvice(limit = SELL_TOP_N): Promise<SellModel> {
  try {
    return sellModelFromResponse(await apiGet<unknown>(`/api/sell-queue/dogfood?limit=${limit}`, SELL_READ_MS));
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Sell queue request failed",
      note: null,
      assumption: null,
      marksNote: null,
      items: [],
    };
  }
}
