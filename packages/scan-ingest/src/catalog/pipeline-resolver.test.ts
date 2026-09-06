import { describe, expect, it } from "vitest";
import {
  FolderWatchAdapter,
  batchInputFromPages,
  confirmScanUnit,
  createCatalogResolver,
  createFixtureCatalogAdapter,
  createMemoryIdentificationCache,
  openScanBatchWithResolver,
  ScanSessionStore,
  type IdObservationRecord,
} from "../index.js";

describe("openScanBatchWithResolver + id_observation sink", () => {
  it("identifies through the resolver and records an observation on confirm", async () => {
    const adapter = new FolderWatchAdapter({
      rootLabel: "scans/fi8170",
      pairing: "sequential_duplex",
      categoryHint: "pokemon",
    });
    adapter.ingestDescriptors([
      {
        fileName: "char_front.jpg",
        bytes: "char-front-resolver",
        ocrText: "Charizard Base Set 4/102 holo",
      },
      { fileName: "char_back.jpg", bytes: "char-back-resolver" },
    ]);
    const pages = await adapter.listPages();
    const store = new ScanSessionStore();
    const observations: IdObservationRecord[] = [];
    const cache = createMemoryIdentificationCache();
    const resolver = createCatalogResolver({
      cache,
      adapters: [createFixtureCatalogAdapter()],
    });

    const first = await openScanBatchWithResolver(
      batchInputFromPages(pages, { categoryHint: "pokemon" }),
      { store, resolver },
    );
    expect(first.batch.units[0]!.candidates[0]?.catalogKey).toBe(
      "pokemon:base-set:4:charizard",
    );
    expect(first.batch.units[0]!.candidates[0]?.adapterId).toBe("fixture-catalog");

    const second = await openScanBatchWithResolver(
      batchInputFromPages(pages, { categoryHint: "pokemon" }),
      { store: new ScanSessionStore(), resolver },
    );
    expect(second.batch.units[0]!.candidates[0]?.catalogKey).toBe(
      first.batch.units[0]!.candidates[0]?.catalogKey,
    );

    const unit = first.batch.units[0]!;
    const confirmed = confirmScanUnit(
      {
        unitId: unit.id,
        selectedCandidateKey: "pokemon:base-set:4:charizard",
      },
      { store, recordIdObservation: (row) => observations.push(row) },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(observations).toHaveLength(1);
    expect(observations[0]!.imageUrl).toBe(unit.frontStorageRef);
    expect(observations[0]!.ocrText).toMatch(/Charizard/);
    expect(observations[0]!.confirmedAssetId).toBe(confirmed.commit.assetId);
    expect(observations[0]!.wasCorrect).toBeNull();
  });
});
