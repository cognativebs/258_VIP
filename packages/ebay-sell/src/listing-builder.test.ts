import { describe, expect, it } from "vitest";
import {
  buildListingDraftPayload,
  buildListingTitle,
  categoryEnvVar,
  categoryIdFor,
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

  it("uses leaf categories, since a parent category fails publish with #25005", () => {
    // 63, 212 and 1 are parents and 19107 is retired — the values that made
    // real Sandbox reject the offer. 183050 is a leaf but sits under Non-Sport
    // Trading Cards, not the CCG branch Pokemon and MTG list in.
    const parents = ["63", "212", "1", "19107", "183050"];
    for (const category of ["comic", "sports", "pokemon", "mtg"] as const) {
      const id = categoryIdFor(category, {});
      expect(id, `${category} needs a leaf category`).toBeTruthy();
      expect(parents, `${category} still points at a non-leaf or retired ID`).not.toContain(id);
    }
    expect(categoryIdFor("comic", {})).toBe("259104");
    expect(categoryIdFor("sports", {})).toBe("261328");
    expect(categoryIdFor("pokemon", {})).toBe("183454");
    expect(categoryIdFor("mtg", {})).toBe("183454");
  });

  it("lets the environment override a category eBay has renumbered", () => {
    expect(categoryEnvVar("comic")).toBe("EBAY_CATEGORY_COMIC");
    expect(categoryIdFor("comic", { EBAY_CATEGORY_COMIC: " 12345 " })).toBe("12345");
    // Blank must not win, or an empty var would block publish on a good default.
    expect(categoryIdFor("comic", { EBAY_CATEGORY_COMIC: "  " })).toBe("259104");
  });

  it("blocks publish for a kind with no leaf category instead of inventing one", () => {
    const draft = buildListingDraftPayload({ ...asset, category: "other" });
    expect(draft.categoryId).toBeNull();
    expect(draft.publishBlockedReasons).toContain("CATEGORY_REQUIRED");
  });

  it("uses the Comics leaf and comic aspects, not sports card aspects", () => {
    const comic = buildListingDraftPayload({
      ...asset,
      category: "comic",
      year: 2013,
      setName: "Age of Ultron",
      playerSubject: "Age of Ultron",
      cardNumber: "2A",
      manufacturer: "Marvel",
      grader: null,
      grade: "NM",
    });
    expect(comic.categoryId).toBe("259104");
    expect(comic.aspects.Publisher).toEqual(["Marvel"]);
    expect(comic.aspects["Issue Number"]).toEqual(["2A"]);
    expect(comic.aspects.Era).toEqual(["Modern Age (1992-Now)"]);
    // "Series Title" is eBay's name for it; a bare "Title" aspect is ignored.
    expect(comic.aspects["Series Title"]).toEqual(["Age of Ultron"]);
    expect(comic.aspects.Title).toBeUndefined();
    expect(comic.aspects["Player/Subject"]).toBeUndefined();
    expect(comic.aspects["Card Number"]).toBeUndefined();
  });
});
