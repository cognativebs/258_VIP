import { describe, expect, it } from "vitest";
import { buildIdentificationReport } from "./identificationReport.js";
import type { StagedBatchRow } from "./scanStorePg.js";

describe("buildIdentificationReport", () => {
  it("exports OCR and adapter ids without image bytes", () => {
    const batch: StagedBatchRow = {
      id: "11111111-1111-1111-1111-111111111111",
      device: "ricoh_fi8170",
      status: "review",
      categoryHint: "pokemon",
      notes: "25 pokemon",
      createdAt: "2026-09-07T00:00:00.000Z",
      source: "ricoh_fi8170",
      scannerProfile: "004_Cards",
      imageCount: 1,
      expectedCardCount: 1,
      processingStatus: "review",
      errorsWarnings: [],
      telemetry: null,
      units: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          unitIndex: 0,
          status: "identified",
          frontStorageRef: "D:/scans/mewtwo_front.jpg",
          backStorageRef: null,
          selectedCandidateKey: null,
          holdingId: null,
          confirmedAssetId: null,
          resolutionMode: null,
          topConfidence: 0.8,
          confidenceBand: "review",
          duplicateAcknowledged: false,
          decisionAction: null,
          frontImageId: "img-1",
          backImageId: null,
          normalizedFrontRef: null,
          normalizedBackRef: null,
          pairingMethod: null,
          pairingConfidence: null,
          pairingNeedsReview: false,
          orientation: null,
          identificationStatus: "inferred",
          reviewStatus: "needs_confirmation",
          reviewRoute: "MEDIUM",
          identityEvidence: {
            debug: {
              rawOcr: { front: "MEWTWO 150", back: "" },
              whyWon: "tcgdex pokemon:tcgdex:base1-10 agreed",
              catalogSource: "tcgdex",
              adapterOutcomes: [{ adapterId: "tcgdex", status: "ok", cardCount: 3 }],
            },
          },
          baseVsParallel: null,
          physicalReimport: false,
          candidates: [
            {
              catalogKey: "pokemon:tcgdex:base1-10",
              displayName: "Mewtwo",
              category: "pokemon",
              setName: "Base Set",
              collectorNumber: "10",
              confidence: 0.8,
              matchReasons: ["name:Mewtwo"],
              adapterId: "tcgdex",
              assetId: null,
              externalIds: [{ source: "tcgdex", value: "base1-10" }],
            },
          ],
        },
      ],
    };

    const report = buildIdentificationReport(batch);
    expect(report.kind).toBe("vip.scan.identification-report");
    expect(report.unitCount).toBe(1);
    expect(report.units[0]?.ocrFront).toBe("MEWTWO 150");
    expect(report.units[0]?.catalogSource).toBe("tcgdex");
    expect(report.units[0]?.winner?.adapterId).toBe("tcgdex");
    expect(JSON.stringify(report)).not.toMatch(/data:image|base64/);
    expect(report.catalog.fixtureCatalog).toBe(false);
  });
});
