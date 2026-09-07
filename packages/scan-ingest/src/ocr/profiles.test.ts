import { describe, expect, it } from "vitest";
import {
  detectVerticalFromText,
  resolveOcrProfile,
  resolveScanProfileHint,
} from "./profiles.js";

describe("resolveScanProfileHint", () => {
  it("maps sport verticals to the sports inventory bucket", () => {
    const football = resolveScanProfileHint("football");
    expect(football.category).toBe("sports");
    expect(football.vertical).toBe("football");
    expect(football.family).toBe("sports");
    expect(football.profileId).toBe("football");
    expect(football.source).toBe("operator");
  });

  it("keeps TCG verticals on their own inventory category", () => {
    expect(resolveScanProfileHint("pokemon").category).toBe("pokemon");
    expect(resolveScanProfileHint("mtg").vertical).toBe("mtg");
    expect(resolveScanProfileHint("one_piece").category).toBe("one_piece");
  });

  it("defaults an empty hint to sports generic without claiming a vertical", () => {
    const empty = resolveScanProfileHint(null);
    expect(empty.profileId).toBe("sports_generic");
    expect(empty.vertical).toBeNull();
    expect(empty.source).toBe("default");
  });
});

describe("detectVerticalFromText", () => {
  it("does not treat Orlando Magic as Magic: The Gathering", () => {
    expect(detectVerticalFromText("2023 Panini Prizm Orlando Magic")).toBeNull();
  });

  it("detects Pokémon from HP / company marks", () => {
    const hit = detectVerticalFromText("Pikachu 60 HP The Pokémon Company 025/198");
    expect(hit?.vertical).toBe("pokemon");
    expect(hit?.source).toBe("inferred");
  });

  it("detects One Piece from OP-set numbers", () => {
    expect(detectVerticalFromText("Monkey D. Luffy OP01-003")).toMatchObject({
      vertical: "one_piece",
    });
  });
});

describe("resolveOcrProfile", () => {
  it("lets an operator football hint win over baseball tokens", () => {
    const { profile, resolved } = resolveOcrProfile({
      hint: "football",
      evidenceText: "2021 Topps Baseball Shohei Ohtani",
    });
    expect(profile.id).toBe("football");
    expect(resolved.source).toBe("operator");
  });

  it("refines a generic sports hint from evidence", () => {
    const { profile, resolved } = resolveOcrProfile({
      hint: "sports",
      evidenceText: "2021 Panini Donruss Football Baker Mayfield",
    });
    expect(profile.id).toBe("football");
    expect(resolved.source).toBe("inferred");
  });
});
