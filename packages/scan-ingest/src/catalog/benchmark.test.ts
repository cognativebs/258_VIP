import { describe, expect, it } from "vitest";
import { scoreIdentificationBenchmark } from "./benchmark.js";
import { buildIdObservation } from "./id-observation.js";
import { markInferred } from "@vip/evidence";
import { randomUUID } from "node:crypto";

describe("scoreIdentificationBenchmark", () => {
  it("reports top-1, parallel, card-number, calibration, failure, and calls", () => {
    const report = scoreIdentificationBenchmark([
      {
        id: "1",
        adapterId: "fixture-catalog",
        predictedCatalogKey: "sports:prizm:wemby:136",
        predictedCollectorNumber: "136",
        predictedParallel: "silver",
        predictedConfidence: 0.95,
        expectedCatalogKey: "sports:prizm:wemby:136",
        expectedCollectorNumber: "136",
        expectedParallel: "silver",
        failed: false,
        providerCalls: 1,
      },
      {
        id: "2",
        adapterId: "fixture-catalog",
        predictedCatalogKey: "sports:prizm:wemby:136",
        predictedCollectorNumber: "136",
        predictedParallel: "base",
        predictedConfidence: 0.92,
        expectedCatalogKey: "sports:prizm:wemby:136",
        expectedCollectorNumber: "136",
        expectedParallel: "red ice",
        failed: false,
        providerCalls: 1,
      },
      {
        id: "3",
        adapterId: "tcgdex",
        predictedCatalogKey: null,
        predictedCollectorNumber: null,
        predictedParallel: null,
        predictedConfidence: null,
        expectedCatalogKey: "pokemon:base-set:4:charizard",
        expectedCollectorNumber: "4",
        expectedParallel: null,
        failed: true,
        providerCalls: 1,
      },
    ]);

    const fixture = report.adapters.find((a) => a.adapterId === "fixture-catalog")!;
    expect(fixture.top1Accuracy).toBe(1);
    expect(fixture.exactParallelAccuracy).toBe(0.5);
    expect(fixture.cardNumberAccuracy).toBe(1);
    expect(fixture.failureRate).toBe(0);
    expect(fixture.callsConsumed).toBe(2);
    expect(fixture.calibration.find((b) => b.band === "high")?.accuracy).toBe(1);

    const tcgdex = report.adapters.find((a) => a.adapterId === "tcgdex")!;
    expect(tcgdex.failureRate).toBe(1);
    expect(tcgdex.top1Accuracy).toBe(0);

    expect(report.overall.cases).toBe(3);
    expect(report.overall.callsConsumed).toBe(3);
    expect(report.overall.failureRate).toBeCloseTo(1 / 3, 3);
  });
});

describe("buildIdObservation", () => {
  it("leaves was_correct null when the prediction had no asset id", () => {
    const confirmed = randomUUID();
    const row = buildIdObservation({
      predicted: {
        catalogKey: "sports:x",
        category: "sports",
        displayName: "Card",
        externalIds: [],
        confidence: 0.7,
        matchReasons: ["token_overlap"],
        provenance: markInferred({
          source: "scan_id_matcher",
          ruleOrModelVersion: "t",
          confidence: 0.7,
        }),
      },
      confirmedAssetId: confirmed,
      imageUrl: "/scans/front.jpg",
      ocrText: "1986 Jordan",
    });
    expect(row.wasCorrect).toBeNull();
    expect(row.predictedAssetId).toBeNull();
    expect(row.predictedConfidence).toBe(0.7);
    expect(row.confirmedAssetId).toBe(confirmed);
  });

  it("records was_correct when predicted and confirmed asset ids match", () => {
    const assetId = randomUUID();
    const row = buildIdObservation({
      predicted: {
        assetId,
        catalogKey: "sports:x",
        category: "sports",
        displayName: "Card",
        externalIds: [],
        confidence: 0.91,
        matchReasons: ["external_id:x"],
        provenance: markInferred({
          source: "scan_id_matcher",
          ruleOrModelVersion: "t",
          confidence: 0.91,
        }),
      },
      confirmedAssetId: assetId,
      imageUrl: "/scans/front.jpg",
    });
    expect(row.wasCorrect).toBe(true);
  });
});
