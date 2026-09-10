import { describe, expect, it } from "vitest";
import { scoreLiveIdentificationGate } from "./live-gate.js";

describe("scoreLiveIdentificationGate", () => {
  it("fails Phase 1 until 25 Pokémon units, tcgdex ids, and scored accuracy", () => {
    const report = scoreLiveIdentificationGate([
      {
        unitId: "u1",
        category: "pokemon",
        displayName: "Charizard",
        adapterId: "tcgdex",
        confidence: 0.9,
        externalSources: ["tcgdex"],
        candidateCount: 1,
        candidatesWithRequiredId: 1,
        holdingWritten: false,
        confirmedCorrect: true,
      },
    ]);
    expect(report.pokemon.units).toBe(1);
    expect(report.pokemon.passed).toBe(false);
    expect(report.pokemon.blockers.some((b) => b.includes("need 25"))).toBe(true);
    expect(report.mtg.units).toBe(0);
    expect(report.mtg.passed).toBe(false);
  });

  it("passes Pokémon when 25 units all have tcgdex ids and top-1 ≥ 80%", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      unitId: `p${i}`,
      category: "pokemon" as const,
      displayName: `Card ${i}`,
      adapterId: "tcgdex",
      confidence: 0.85,
      externalSources: ["tcgdex"],
      candidateCount: 1,
      candidatesWithRequiredId: 1,
      holdingWritten: false,
      confirmedCorrect: i < 21,
    }));
    const report = scoreLiveIdentificationGate(rows);
    expect(report.pokemon.top1Accuracy).toBe(0.84);
    expect(report.pokemon.passed).toBe(true);
    expect(report.pokemon.blockers).toEqual([]);
  });

  it("flags a missing tcgdex id even when accuracy is high", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      unitId: `p${i}`,
      category: "pokemon" as const,
      displayName: `Card ${i}`,
      adapterId: i === 0 ? "fixture-catalog" : "tcgdex",
      externalSources: i === 0 ? [] : ["tcgdex"],
      candidateCount: 1,
      candidatesWithRequiredId: i === 0 ? 0 : 1,
      confirmedCorrect: true,
    }));
    const report = scoreLiveIdentificationGate(rows);
    expect(report.pokemon.passed).toBe(false);
    expect(
      report.pokemon.blockers.some((b) => b.includes("missing tcgdex")),
    ).toBe(true);
  });
});
