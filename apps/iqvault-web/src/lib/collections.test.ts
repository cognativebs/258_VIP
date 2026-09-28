import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COLLECTIONS, pokemonCollectionHoldings, splitTcgHoldings } from "./collections";
import type { Holding } from "./api";
import { POKEMON_TABLE_COLUMNS } from "./comicEngine";

describe("collection routes", () => {
  it("puts the Pokémon terminal on /collections/pokemon and has no /collections/tcg route", () => {
    const pokemon = COLLECTIONS.find((c) => c.id === "pokemon");
    assert.ok(pokemon);
    assert.equal(pokemon?.href, "/collections/pokemon");
    assert.equal(pokemon?.label, "Pokémon");
    assert.equal(
      COLLECTIONS.some((c) => c.href === "/collections/tcg"),
      false,
    );
    const tcgDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "app",
      "collections",
      "tcg",
    );
    assert.equal(existsSync(tcgDir), false);
  });

  it("keeps Need Binder out of the Pokémon collection count", () => {
    const holdings = [
      {
        id: "binder-slot-owned",
        assetName: "Owned",
        series: "Base",
        issue: "1",
        publisher: "",
        quantity: 1,
        pillar: "TCG Owned (Binder)",
        museumScore: null,
        investmentScore: null,
        liquidityScore: null,
        recommendationLabel: "Hold",
        sellPriority: "Low",
        needsGrading: false,
        needsPhoto: false,
        needsVerification: true,
        verificationNotes: null,
        currentPrice: 10,
        assumedGrade: null,
        gradeRating: null,
        provenance: {
          source: "binder-vault",
          method: "inferred",
          confidence: 0.5,
          verificationStatus: "unverified",
          ruleOrModelVersion: "test@0",
        },
      },
      {
        id: "binder-slot-need",
        assetName: "Need",
        series: "Base",
        issue: "2",
        publisher: "",
        quantity: 1,
        pillar: "TCG Need (Binder)",
        museumScore: null,
        investmentScore: null,
        liquidityScore: null,
        recommendationLabel: "Hunt",
        sellPriority: null,
        needsGrading: false,
        needsPhoto: false,
        needsVerification: true,
        verificationNotes: null,
        currentPrice: 20,
        assumedGrade: null,
        gradeRating: null,
        provenance: {
          source: "binder-vault",
          method: "inferred",
          confidence: 0.5,
          verificationStatus: "unverified",
          ruleOrModelVersion: "test@0",
        },
      },
    ] as Holding[];
    const split = splitTcgHoldings(holdings);
    assert.equal(split.need.length, 1);
    assert.deepEqual(
      pokemonCollectionHoldings(split).map((h) => h.id),
      ["binder-slot-owned"],
    );
  });

  it("shows NAME as the first Pokémon column and keeps art out of the grid", () => {
    assert.equal(POKEMON_TABLE_COLUMNS[0]?.id, "Title");
    assert.equal(POKEMON_TABLE_COLUMNS[0]?.label, "NAME");
    assert.equal(
      POKEMON_TABLE_COLUMNS.some((c: { id: string }) => c.id === "Cover Image URL"),
      false,
    );
  });
});
