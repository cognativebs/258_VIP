import { randomUUID } from "node:crypto";
import {
  BuyOpportunityScanSchema,
  MarketCycleStateSchema,
  type BuyOpportunityScan,
  type MarketCycleState,
} from "./schemas.js";

export class Phase2BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase2BlockedError";
  }
}

/**
 * Manual / backfilled cycle row only. Classification logic is blocked on
 * Signals ingestion (signals_raw / signals_normalized) — not confirmed live.
 */
export function recordManualCycleState(
  input: Omit<MarketCycleState, "id" | "dataSource"> & { id?: string },
): MarketCycleState {
  return MarketCycleStateSchema.parse({
    ...input,
    id: input.id ?? randomUUID(),
    dataSource: "manual",
  });
}

export function recordManualBuyOpportunity(
  input: Omit<BuyOpportunityScan, "id" | "dataSource"> & { id?: string },
): BuyOpportunityScan {
  return BuyOpportunityScanSchema.parse({
    ...input,
    id: input.id ?? randomUUID(),
    dataSource: "manual",
  });
}

/** Explicitly not implemented — do not call until Signals ingestion is live. */
export function classifyMarketCycle(): never {
  throw new Phase2BlockedError(
    "Market Cycle Detector scoring is blocked until Signals ingestion is confirmed live",
  );
}

/** Explicitly not implemented — no scheduled scan job in this phase. */
export function scanBuyOpportunities(): never {
  throw new Phase2BlockedError(
    "Buy Opportunity Scanner scoring is blocked until Signals ingestion and market_cycle_detector land",
  );
}

/** Schema exists; Collection Quality Density waits on collection_synergy_score usage. */
export function suggestPortfolioConsolidation(): never {
  throw new Phase2BlockedError(
    "Portfolio consolidation suggestions wait until collection_synergy_score is in production use",
  );
}
