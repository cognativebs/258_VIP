import { EvidenceItemSchema, type EvidenceItem } from "./types.js";

/** Minimal signal shape for bridging — matches NormalizedSignalFromRss / feed rows. */
export type SignalEvidenceInput = {
  id: string;
  body?: string;
  title?: string;
  signalType?: string;
  quarantineStatus?: string;
  provenance?: {
    source?: string;
    verificationStatus?: string;
  };
};

/**
 * Map signals → evidence refs for recommend().
 * Quarantined/rejected signals become opposing risk; active news can support or oppose
 * via light heuristics (reprint/noise → opposing). Never invent prices.
 */
export function signalsToEvidenceRefs(signals: SignalEvidenceInput[]): EvidenceItem[] {
  const refs: EvidenceItem[] = [];
  for (const s of signals) {
    const summaryBase = (s.body || s.title || "signal").slice(0, 180);
    const source = s.provenance?.source ?? "signal";
    if (s.quarantineStatus === "quarantined" || s.quarantineStatus === "rejected") {
      refs.push(
        EvidenceItemSchema.parse({
          id: `signal:${s.id}`,
          kind: "signal",
          summary: `Quarantined signal (${source}): ${summaryBase}`,
          polarity: "opposing",
          weight: 0.4,
        }),
      );
      continue;
    }
    const noise =
      /reprint|rumor|chatter|unverified|noise/i.test(summaryBase) ||
      s.signalType === "retail";
    refs.push(
      EvidenceItemSchema.parse({
        id: `signal:${s.id}`,
        kind: "signal",
        summary: `Signal (${source}${s.signalType ? `/${s.signalType}` : ""}): ${summaryBase}`,
        polarity: noise ? "opposing" : "supporting",
        weight: 0.45,
      }),
    );
  }
  return refs;
}
