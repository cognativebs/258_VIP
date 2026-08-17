import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COLLECTIONS } from "./collections";
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

  it("shows NAME as the first Pokémon column and keeps art out of the grid", () => {
    assert.equal(POKEMON_TABLE_COLUMNS[0]?.id, "Title");
    assert.equal(POKEMON_TABLE_COLUMNS[0]?.label, "NAME");
    assert.equal(
      POKEMON_TABLE_COLUMNS.some((c: { id: string }) => c.id === "Cover Image URL"),
      false,
    );
  });
});
