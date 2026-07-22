import { describe, expect, it } from "vitest";
import { noveltyScore, dedupeKey } from "./dedupe.js";
import { runSignalPipeline } from "./pipeline.js";
import { AppendOnlyStageStore } from "./store.js";
import { PredictionLedger, brierScore } from "./prediction-ledger.js";

describe("dedupe + novelty", () => {
  it("detects repeated titles as low novelty", () => {
    const body = "Pokemon 30th ETB restock at Target overnight";
    const n = noveltyScore(body, [body, "unrelated comic news"]);
    expect(n.suggestQuarantine).toBe(true);
    expect(n.score).toBeLessThan(0.2);
  });

  it("stable dedupe keys for same URL", () => {
    const a = dedupeKey({ sourceId: "x", title: "A", url: "https://Example.com/a" });
    const b = dedupeKey({ sourceId: "x", title: "B", url: "https://example.com/a" });
    expect(a).toBe(b);
  });
});

describe("pipeline", () => {
  it("stores every stage append-only and never overwrites", () => {
    const store = new AppendOnlyStageStore();
    const result = runSignalPipeline(
      [
        {
          sourceId: "retail-drop-watch",
          title: "30th BB listed",
          body: "Booster box spotted online at MSRP-ish",
          assetHints: ["pokemon-30th-bb"],
          externalId: "drop-1",
        },
        {
          sourceId: "retail-drop-watch",
          title: "30th BB listed again",
          body: "Booster box spotted online at MSRP-ish",
          assetHints: ["pokemon-30th-bb"],
          externalId: "drop-1",
        },
      ],
      { store },
    );

    expect(result.stages.length).toBeGreaterThan(5);
    expect(result.delta.quarantined).toBeGreaterThanOrEqual(1);
    expect(() => store.update(result.stages[0]!.id)).toThrow(/append-only/i);

    const stages = new Set(result.stages.map((s) => s.stage));
    expect(stages.has("SourceObservation")).toBe(true);
    expect(stages.has("NormalizedSignal")).toBe(true);
    expect(stages.has("RecommendationChange")).toBe(true);
  });
});

describe("prediction ledger", () => {
  it("tracks Brier scores on resolution", () => {
    expect(brierScore(0.8, 1)).toBeCloseTo(0.04);
    const ledger = new PredictionLedger();
    const p = ledger.add({
      claim: "AB #1 stays above $20 for 30d",
      probability: 0.7,
      createdAt: new Date("2026-06-01"),
      expiresAt: new Date("2026-07-01"),
      evidenceRefs: ["sig-1"],
      action: "Hold",
    });
    ledger.resolve(p.id, "hit");
    const summary = ledger.calibrationSummary();
    expect(summary.scored).toBe(1);
    expect(summary.averageBrier).toBeCloseTo(0.09);
  });
});
