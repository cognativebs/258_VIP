import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  FolderWatchAdapter,
  batchInputFromPages,
  confirmScanUnit,
  openScanBatch,
  ScanSessionStore,
  FIXTURE_CATALOG,
  SCAN_HOLDING_SOURCE,
} from "./index.js";

describe("Ricoh fi-8170 scan → inventory pipeline", () => {
  it("end-to-end: open batch → confirm Hold with NM assumed provenance", async () => {
    const adapter = new FolderWatchAdapter({
      rootLabel: "scans/fi8170",
      pairing: "sequential_duplex",
      categoryHint: "sports",
    });
    adapter.ingestDescriptors([
      {
        fileName: "card001_front.jpg",
        bytes: "front-jordan",
        ocrText: "1986 Topps Michael Jordan 57",
      },
      {
        fileName: "card001_back.jpg",
        bytes: "back-jordan",
      },
    ]);
    const pages = await adapter.listPages();
    const input = batchInputFromPages(pages, { categoryHint: "sports" });
    const store = new ScanSessionStore();
    const { batch, rawSnapshots } = openScanBatch(input, {
      store,
      catalog: FIXTURE_CATALOG,
    });

    expect(batch.device).toBe("ricoh_fi8170");
    expect(batch.qualityTier).toBe("intake");
    expect(batch.units).toHaveLength(1);
    expect(rawSnapshots).toHaveLength(1);

    const unit = batch.units[0]!;
    expect(unit.candidates[0]?.catalogKey).toBe("sports:topps:1986:jordan:57");
    expect(unit.candidates[0]?.provenance.method).toBe("inferred");
    expect(unit.candidates[0]?.provenance.verificationStatus).toBe("unverified");

    const result = confirmScanUnit(
      {
        unitId: unit.id,
        selectedCandidateKey: "sports:topps:1986:jordan:57",
        quantity: 1,
        queueEbayListingDraft: true,
      },
      { store },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.decisionAction).toBe("Hold");
    expect(result.commit.source).toBe(SCAN_HOLDING_SOURCE);
    expect(result.commit.assumedGrade).toBe("NM");
    expect(result.commit.needsVerification).toBe(true);
    expect(result.commit.provenance.notes).toMatch(/NM assumed · unverified/);
    expect(result.ebayDraft?.status).toBe("pending_credentials");
    expect(result.ebayDraft?.emptyReason).toMatch(/tokens not configured/);
    expect(result.unit.status).toBe("confirmed");
    expect(result.unit.confirmedAssetId).toBe(result.commit.assetId);

    const again = confirmScanUnit(
      {
        unitId: unit.id,
        selectedCandidateKey: "sports:topps:1986:jordan:57",
      },
      { store },
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.commit.assetId).toBe(result.commit.assetId);
  });

  it("keeps batch-open duplicate alert when confirm inventory is empty", async () => {
    const adapter = new FolderWatchAdapter({
      rootLabel: "scans/fi8170",
      pairing: "sequential_duplex",
      categoryHint: "pokemon",
    });
    adapter.ingestDescriptors([
      {
        fileName: "char_front.jpg",
        bytes: "char-front-2",
        ocrText: "Charizard Base Set 4/102 holo",
      },
      { fileName: "char_back.jpg", bytes: "char-back-2" },
    ]);
    const pages = await adapter.listPages();
    const store = new ScanSessionStore();
    const { batch } = openScanBatch(
      batchInputFromPages(pages, { categoryHint: "pokemon" }),
      {
        store,
        catalog: FIXTURE_CATALOG,
        inventory: [
          {
            id: "holding-existing-charizard",
            assetName: "Charizard",
            quantity: 1,
            catalogKey: "pokemon:base-set:4:charizard",
            externalIds: [{ source: "pokemontcg", value: "base1-4" }],
          },
        ],
      },
    );
    const unit = batch.units[0]!;
    expect(unit.status).toBe("duplicate_alert");

    const blocked = confirmScanUnit(
      {
        unitId: unit.id,
        selectedCandidateKey: "pokemon:base-set:4:charizard",
        acknowledgeDuplicates: false,
      },
      { store, inventory: [] },
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("DUPLICATE_UNACKNOWLEDGED");
  });

  it("alerts on duplicates and blocks confirm until acknowledged", async () => {
    const adapter = new FolderWatchAdapter({
      rootLabel: "scans/fi8170",
      pairing: "sequential_duplex",
      categoryHint: "pokemon",
    });
    adapter.ingestDescriptors([
      {
        fileName: "char_front.jpg",
        bytes: "char-front",
        ocrText: "Charizard Base Set 4/102 holo",
      },
      { fileName: "char_back.jpg", bytes: "char-back" },
    ]);
    const pages = await adapter.listPages();
    const store = new ScanSessionStore();
    const existingAsset = randomUUID();
    const { batch } = openScanBatch(
      batchInputFromPages(pages, { categoryHint: "pokemon" }),
      {
        store,
        catalog: FIXTURE_CATALOG,
        inventory: [
          {
            id: "holding-existing-charizard",
            assetId: existingAsset,
            assetName: "Charizard",
            quantity: 1,
            catalogKey: "pokemon:base-set:4:charizard",
            externalIds: [{ source: "pokemontcg", value: "base1-4" }],
          },
        ],
      },
    );

    const unit = batch.units[0]!;
    expect(unit.status).toBe("duplicate_alert");
    expect(unit.duplicateAlert?.duplicates[0]?.holdingId).toBe(
      "holding-existing-charizard",
    );

    const blocked = confirmScanUnit(
      {
        unitId: unit.id,
        selectedCandidateKey: "pokemon:base-set:4:charizard",
        acknowledgeDuplicates: false,
      },
      {
        store,
        inventory: [
          {
            id: "holding-existing-charizard",
            assetId: existingAsset,
            assetName: "Charizard",
            quantity: 1,
            catalogKey: "pokemon:base-set:4:charizard",
            externalIds: [{ source: "pokemontcg", value: "base1-4" }],
          },
        ],
      },
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("DUPLICATE_UNACKNOWLEDGED");

    const allowed = confirmScanUnit(
      {
        unitId: unit.id,
        selectedCandidateKey: "pokemon:base-set:4:charizard",
        acknowledgeDuplicates: true,
      },
      {
        store,
        inventory: [
          {
            id: "holding-existing-charizard",
            assetId: existingAsset,
            assetName: "Charizard",
            quantity: 1,
            catalogKey: "pokemon:base-set:4:charizard",
            externalIds: [{ source: "pokemontcg", value: "base1-4" }],
          },
        ],
      },
    );
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.commit.duplicateAcknowledged).toBe(true);
    expect(allowed.commit.verificationNotes).toMatch(/Duplicate acknowledged/);
  });

  it("marks eBay draft ready when oauth token present (still not submitted)", async () => {
    const adapter = new FolderWatchAdapter({
      rootLabel: "scans/fi8170",
      pairing: "filename_front_back",
    });
    adapter.ingestDescriptors([
      {
        fileName: "wemby_front.jpg",
        bytes: "wemby-f",
        ocrText: "2023 Panini Prizm Victor Wembanyama 136",
      },
      { fileName: "wemby_back.jpg", bytes: "wemby-b" },
    ]);
    const pages = await adapter.listPages();
    const store = new ScanSessionStore();
    const { batch } = openScanBatch(
      batchInputFromPages(pages, {
        pairing: "filename_front_back",
        categoryHint: "sports",
      }),
      { store, catalog: FIXTURE_CATALOG },
    );
    const unit = batch.units[0]!;
    const result = confirmScanUnit(
      {
        unitId: unit.id,
        selectedCandidateKey: unit.candidates[0]!.catalogKey,
        queueEbayListingDraft: true,
      },
      { store, ebayCreds: { oauthToken: "test-token" } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ebayDraft?.status).toBe("draft_ready");
    expect(result.ebayDraft?.listingPayload).toMatchObject({
      submitReady: false,
    });
  });
});
