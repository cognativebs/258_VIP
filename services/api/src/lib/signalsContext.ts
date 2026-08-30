import {
  SIGNALS_CONTEXT_CAP,
  SIGNALS_CONTEXT_RULE,
  SignalsContextSchema,
  SignalBucketOutputSchema,
  type SignalBucketOutput,
  type SignalsContext,
} from "@vip/core-model";
import { defaultSignalsFeedPath, readSignalsFeed, type FeedSignal } from "./signalsFeed.js";

const NEWS_NOTE =
  "News is inferred · unverified RSS; not a market fact; do not invent comps from headlines.";

export function compactSignalsContext(
  feedPath = defaultSignalsFeedPath(),
): SignalsContext {
  const feed = readSignalsFeed(feedPath);
  if (!feed) {
    return SignalsContextSchema.parse({
      active: [],
      quarantinedCount: 0,
      feedKind: "empty",
      provenance: {
        source: "signals_feed",
        method: "inferred",
        ruleOrModelVersion: SIGNALS_CONTEXT_RULE,
        verificationStatus: "unverified",
        notes: `${NEWS_NOTE} Feed file missing — omit block; do not invent “no news” as a priced event.`,
      },
    });
  }
  const quarantined = feed.signals.filter((s) => s.quarantineStatus === "quarantined");
  const active = feed.signals
    .filter((s) => s.quarantineStatus === "active")
    .slice(0, SIGNALS_CONTEXT_CAP)
    .map((s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      sourceId: feed.job ?? feed.provenance.source,
      publishedAt: s.signalDate,
      signalType: s.signalType,
      quarantineStatus: s.quarantineStatus,
      confidence: s.noveltyScore ?? 0.4,
      ruleVersion: feed.provenance.ruleOrModelVersion,
    }));
  return SignalsContextSchema.parse({
    active,
    quarantinedCount: quarantined.length,
    feedKind: "job_feed",
    provenance: {
      source: feed.provenance.source,
      method: "inferred",
      ruleOrModelVersion: SIGNALS_CONTEXT_RULE,
      verificationStatus: "unverified",
      notes: NEWS_NOTE,
    },
  });
}

/** Basic Signals output: map active headlines to bucket-aware actions. Never a price. */
export function basicSignalsOutput(signals: FeedSignal[]): SignalBucketOutput[] {
  return signals
    .filter((s) => s.quarantineStatus === "active")
    .slice(0, SIGNALS_CONTEXT_CAP)
    .map((s) => {
      const blob = `${s.title ?? ""} ${s.body}`.toLowerCase();
      const reprint = /reprint|restock|reprint/.test(blob) || s.signalType === "reprint";
      const retail = s.signalType === "retail" || /drop|released|preorder/.test(blob);
      const auction = s.signalType === "auction" || /auction|hammer/.test(blob);
      const market = s.signalType === "market";

      let action: SignalBucketOutput["action"] = "Review";
      let bucketHint: SignalBucketOutput["bucketHint"] = "investment_vault";
      let reason = "Headline is inferred · unverified — review Investment Vault exposure.";

      if (reprint || retail) {
        action = "Hold";
        bucketHint = "personal_collection";
        reason =
          "Supply/retail headline — do not list Personal Collection. Hold keepers; no invented comps.";
      } else if (auction || market) {
        action = "Churn";
        bucketHint = "dealer_inventory";
        reason =
          "Market/auction headline — Dealer Inventory may churn if a live range exists. Not a Sell instruction.";
      }

      return SignalBucketOutputSchema.parse({
        signalId: s.id,
        title: s.title ?? s.signalType,
        body: s.body,
        action,
        bucketHint,
        reason,
        confidence: s.noveltyScore ?? 0.35,
      });
    });
}

export function signalsOutputFromFeed(feedPath = defaultSignalsFeedPath()) {
  const feed = readSignalsFeed(feedPath);
  const outputs = basicSignalsOutput(feed?.signals ?? []);
  return {
    outputs,
    feedKind: feed ? ("job_feed" as const) : ("empty" as const),
    provenance: {
      source: feed?.provenance.source ?? "signals_feed",
      method: "inferred" as const,
      ruleOrModelVersion: SIGNALS_CONTEXT_RULE,
      verificationStatus: "unverified" as const,
      notes: NEWS_NOTE,
    },
  };
}
