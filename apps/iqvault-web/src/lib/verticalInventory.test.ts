import assert from "node:assert/strict";
import { test } from "node:test";
import type { Holding } from "./api";
import { getCollectionTab } from "./collectionTabs";
import {
  classifyHoldingVertical,
  filterByVerticalWorkspace,
  holdingsForTab,
} from "./verticalInventory";
import type { ComicRow } from "./comicTypes";

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
  const pokemon = getCollectionTab("pokemon");
  assert.ok(pokemon);
  const owned = filterByVerticalWorkspace(rows, "owned", pokemon);
  assert.deepEqual(owned.map((r) => r.id), ["1"]);
});

test("collection tabs keep explicit hrefs and honest status", () => {
  const comic = getCollectionTab("comic");
  const pokemon = getCollectionTab("pokemon");
  const mtg = getCollectionTab("mtg");
  assert.equal(comic?.href, "/collections/comics");
  assert.equal(pokemon?.href, "/collections/pokemon");
  assert.equal(pokemon?.status, "live");
  // MTG has a schema but no holdings loader — it must not claim to be live.
  assert.equal(mtg?.status, "planned");
  assert.equal(getCollectionTab("nope"), null);
});
