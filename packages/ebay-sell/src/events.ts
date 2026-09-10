import { MarketEventSchema, type MarketEvent } from "./schemas.js";

export const MARKET_EVENT_TYPES = [
  "BREAKOUT_PERFORMANCE",
  "INJURY",
  "DEPTH_CHART_CHANGE",
  "AWARD",
  "PLAYOFF_CLINCH",
  "RECORD_MILESTONE",
  "MARKET_SPIKE",
] as const;

export type MarketEventType = (typeof MARKET_EVENT_TYPES)[number];

/** Generic event seam — no news vendor is wired into the eBay adapter. */
export function parseMarketEvent(raw: unknown): MarketEvent {
  return MarketEventSchema.parse(raw);
}

export function eventAffectsAsset(
  event: MarketEvent,
  asset: { inventoryId: string; playerSubject?: string | null; team?: string | null },
): boolean {
  if (event.expiresAt && event.expiresAt.getTime() <= Date.now()) return false;
  return (
    event.subjectId === asset.inventoryId ||
    event.subjectId === asset.playerSubject ||
    event.subjectId === asset.team
  );
}

export function highValueRequiresApproval(fmvMid: number | null, highValueUsd: number): boolean {
  return fmvMid != null && fmvMid >= highValueUsd;
}
