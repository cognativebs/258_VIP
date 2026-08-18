import assert from "node:assert/strict";
import { test } from "node:test";
import type { Holding } from "./api.ts";
import { getCollectionTab } from "./collectionTabs.ts";
import {
  classifyHoldingVertical,
  filterByVerticalWorkspace,
  holdingsForTab,
} from "./verticalInventory.ts";
import type { ComicRow } from "./comicTypes.ts";

function holding(partial: Partial<Holding> & Pick<Holding, "id">): Holding {
  return {
    assetName: "x",
    series: "x",
    issue: "1",
    publisher: "",
    quantity: 1,
    pillar: null,
    museumScore: null,
    investmentScore: null,
    liquidityScore: null,
    recommendationLabel: null,
    sellPriority: null,
    needsGrading: false,
    needsPhoto: false,
    needsVerification: true,
    verificationNotes: null,
    currentPrice: null,
    assumedGrade: null,
    gradeRating: null,
    provenance: {
      source: "test",
      method: "fixture",
      confidence: 0.5,
      verificationStatus: "unverified",
      ruleOrModelVersion: "test@0",
    },
    ...partial,
  };
}

test("binder slots classify as pokemon TCG", () => {
  const h = holding({
    id: "binder-slot-1",
    pillar: "TCG Owned (Binder)",
    publisher: "The Pokémon Company",
    externalIds: [{ source: "pokemontcg", externalValue: "base1-4" }],
  });
  assert.equal(classifyHoldingVertical(h), "pokemon");
  assert.equal(holdingsForTab([h], "pokemon").length, 1);
  assert.equal(holdingsForTab([h], "comic").length, 0);
});

test("scryfall ids classify as MTG", () => {
  const h = holding({
    id: "abc",
    pillar: "TCG Owned (Binder)",
    externalIds: [{ source: "scryfall", externalValue: "abc" }],
  });
  assert.equal(classifyHoldingVertical(h), "mtg");
});

test("owned workspace keeps binder-owned rows", () => {
  const rows: ComicRow[] = [
    { id: "1", Series: "Base", "Collection Pillar": "TCG Owned (Binder)" },
    { id: "2", Series: "Base", "Collection Pillar": "TCG Need (Binder)" },
  ];
  const owned = filterByVerticalWorkspace(rows, "owned", getCollectionTab("pokemon"));
  assert.deepEqual(owned.map((r) => r.id), ["1"]);
});
