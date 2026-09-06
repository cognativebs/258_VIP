import { describe, expect, it } from "vitest";
import {
  buildListingDraftPayload,
  buildListingTitle,
  shortenTitle,
  stripHype,
} from "./listing-builder.js";
import type { SellingAssetInput } from "./schemas.js";

const asset: SellingAssetInput = {
  inventoryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  holdingUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  sourceRowId: "src-1",
  category: "sports",
  year: 2018,
  setName: "Prizm",
  playerSubject: "Patrick Mahomes",
  team: "Chiefs",
  cardNumber: "207",
  parallel: "Silver",
  grader: "PSA",
  grade: "10",
  frontImageUri: "https://img.example/front.jpg",
  backImageUri: "https://img.example/back.jpg",
  ownershipBucket: "dealer_inventory",
  salesPathState: "available",
  quantity: 1,
  fmv: {
    low: 40,
    high: 50,
    mid: 45,
    currency: "USD",
    confidence: 0.5,
    evidenceCount: 6,
    source: "ebay_browse",
    method: "inferred",
    verificationStatus: "unverified",
    recencyDays: 1,
  },
  rookieFlag: true,
  autographFlag: false,
  relicFlag: false,
  parallelScarce: false,
  strongPlayerDemand: true,
  strongSearchability: true,
  playerTier: "star",
  saleVelocity: "hot",
  marketTrend: "up",
  pcThesis: false,
  holdThesis: false,
  gradeThesis: false,
  relatedLotCount: 0,
};

describe("listing builder", () => {
  it("builds a searchable title under the eBay length cap", () => {
    const title = buildListingTitle(asset);
    expect(title).toContain("2018");
    expect(title).toContain("Mahomes");
    expect(title).toContain("#207");
    expect(title.length).toBeLessThanOrEqual(80);
    expect(stripHype("Must have grail investment Mahomes")).toBe("Mahomes");
    expect(shortenTitle("a ".repeat(80), 80).length).toBeLessThanOrEqual(80);
  });

  it("blocks publish without images or identity", () => {
    const ok = buildListingDraftPayload(asset);
    expect(ok.publishBlockedReasons).toEqual([]);
    expect(ok.sku.startsWith("IQV-SPORTS-")).toBe(true);
    const blocked = buildListingDraftPayload({
      ...asset,
      frontImageUri: null,
      backImageUri: null,
      playerSubject: null,
      setName: null,
    });
    expect(blocked.publishBlockedReasons).toContain("IMAGE_REQUIRED");
    expect(blocked.publishBlockedReasons).toContain("IDENTITY_PLAYER_REQUIRED");
  });
});
