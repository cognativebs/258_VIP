import { describe, expect, it } from "vitest";
import { identificationReportFromBatch, type StagedBatch } from "./scanApi";

describe("identificationReportFromBatch", () => {
  it("copies OCR and candidates from a batch already on screen", () => {
    const batch = {
      id: "179f7604-be98-4b3a-b3a7-dc56b5ce5f04",
      device: "ricoh_fi8170",
      status: "review",
      categoryHint: "pokemon",
      notes: null,
      createdAt: "2026-09-07T00:00:00.000Z",
      units: [
        {
          id: "unit-1",
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
          identityEvidence: {
            debug: {
              rawOcr: { front: "MEWTWO 150", back: "" },
              catalogSource: "tcgdex",
              whyWon: "tcgdex",
            },
          },
          candidates: [
            {
              catalogKey: "pokemon:tcgdex:sv03.5-150",
              displayName: "Mewtwo",
              category: "pokemon",
              setName: null,
              collectorNumber: "150",
              confidence: 0.8,
              matchReasons: ["name:Mewtwo"],
              adapterId: "tcgdex",
              assetId: null,
            },
          ],
        },
      ],
    } as StagedBatch;

    const report = identificationReportFromBatch(batch, {
      resolverEnabledFor: ["pokemon"],
      adapters: [{ id: "tcgdex", label: "TCGdex (pokemon)" }],
      tcgdex: true,
      fixtureCatalog: false,
      note: "live",
    });
    expect(report.batchId).toBe(batch.id);
    expect(JSON.stringify(report)).toContain("MEWTWO 150");
    expect(JSON.stringify(report)).toContain("tcgdex");
    expect(JSON.stringify(report)).not.toMatch(/base64/);
  });
});
