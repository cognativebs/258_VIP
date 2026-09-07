import { describe, expect, it } from "vitest";
import { parseTcgIdentity, tcgParsedCandidate } from "./tcgIdentity.js";

describe("parseTcgIdentity", () => {
  it("reads a Pokémon name and set-fraction number without requiring a year", () => {
    const parsed = parseTcgIdentity("Charizard 4/102 The Pokémon Company 120 HP", "pokemon");
    expect(parsed?.name).toMatch(/Charizard/i);
    expect(parsed?.collectorNumber).toBe("4/102");
    expect(parsed?.category).toBe("pokemon");
    expect(parsed?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not treat HP as the collector number", () => {
    const parsed = parseTcgIdentity("Pikachu 60 HP Scarlet Violet", "pokemon");
    expect(parsed?.collectorNumber ?? null).toBeNull();
    expect(parsed?.name).toMatch(/Pikachu/i);
  });

  it("reads an MTG name and set-code number", () => {
    const parsed = parseTcgIdentity("Black Lotus LEA 232 Wizards of the Coast", "mtg");
    expect(parsed?.name).toMatch(/Black Lotus/i);
    expect(parsed?.collectorNumber).toBe("LEA 232");
    expect(parsed?.category).toBe("mtg");
  });

  it("rejects Power/Toughness-looking fractions as MTG collector numbers", () => {
    const parsed = parseTcgIdentity("Grizzly Bears 2/2 Creature Magic", "mtg");
    expect(parsed?.collectorNumber ?? null).toBeNull();
    expect(parsed?.name).toMatch(/Grizzly Bears/i);
  });

  it("reads a One Piece Bandai number", () => {
    const parsed = parseTcgIdentity("Monkey D. Luffy Leader OP01-003 Bandai", "one_piece");
    expect(parsed?.name).toMatch(/Luffy/i);
    expect(parsed?.collectorNumber).toBe("OP01-003");
    expect(parsed?.category).toBe("one_piece");
  });
});

describe("tcgParsedCandidate", () => {
  it("marks the candidate inferred · unverified", () => {
    const cand = tcgParsedCandidate("Charizard Base Set 4/102 holo pokemon", "pokemon");
    expect(cand?.catalogKey).toMatch(/pokemon:parsed:/);
    expect(cand?.provenance.verificationStatus).toBe("unverified");
    expect(cand?.provenance.notes).toMatch(/unverified/);
  });
});
