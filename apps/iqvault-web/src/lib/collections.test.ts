import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COLLECTIONS } from "./collections";

describe("collection routes", () => {
  it("puts the Pokémon terminal on /collections/pokemon, not /collections/tcg", () => {
    const pokemon = COLLECTIONS.find((c) => c.id === "pokemon");
    assert.ok(pokemon);
    assert.equal(pokemon?.href, "/collections/pokemon");
    assert.equal(pokemon?.label, "Pokémon");
    assert.equal(
      COLLECTIONS.some((c) => c.href === "/collections/tcg"),
      false,
    );
  });
});
