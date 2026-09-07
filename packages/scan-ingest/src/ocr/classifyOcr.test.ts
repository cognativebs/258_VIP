import { describe, expect, it } from "vitest";
import {
  classifyOcrLine,
  extractStructuredFromOcr,
  privilegedOcrIsComplete,
  spansFromTextBlock,
} from "./classifyOcr.js";
import { getOcrProfile } from "./profiles.js";

describe("classifyOcrLine", () => {
  it("does not treat biography prose as a title", () => {
    expect(classifyOcrLine("Houston brought in Tyrod Taylor to start")).toBe("body");
    expect(
      classifyOcrLine("2021 Panini #0001 Houston Brought In Tyrod"),
    ).toBe("card_number");
  });

  it("does not treat four-token OCR garbage as a title", () => {
    expect(classifyOcrLine("Yer Ore Oo Ns")).toBe("unknown");
    expect(classifyOcrLine("2024 #8 Yer Ore Oo Ns")).toBe("card_number");
    expect(classifyOcrLine("Pmreianm We Kz Ie")).toBe("unknown");
  });

  it("keeps labeled number / product / two-word player lines", () => {
    expect(classifyOcrLine("NO. 195")).toBe("card_number");
    expect(classifyOcrLine("2021 PANINI DONRUSS FOOTBALL")).toBe("product");
    expect(classifyOcrLine("BAKER MAYFIELD")).toBe("title");
    expect(classifyOcrLine("CJ STROUD")).toBe("title");
    expect(classifyOcrLine("C) STROUD")).toBe("title");
  });
});

describe("extractStructuredFromOcr", () => {
  it("extracts Baker from privileged regions only", () => {
    const extract = extractStructuredFromOcr(
      spansFromTextBlock("BAKER MAYFIELD\n2021 PANINI DONRUSS FOOTBALL\nNO. 195"),
    );
    expect(extract.player).toBe("Baker Mayfield");
    expect(extract.year).toBe(2021);
    expect(extract.manufacturer).toBe("Panini");
    expect(extract.brand).toBe("Donruss");
    expect(extract.number).toBe("195");
  });

  it("never promotes biography leftover as the player", () => {
    const extract = extractStructuredFromOcr(
      spansFromTextBlock("2021 Panini #0001 Houston Brought In Tyrod"),
    );
    expect(extract.player).toBeNull();
    expect(extract.year).toBe(2021);
    expect(extract.manufacturer).toBe("Panini");
    expect(extract.number).toBe("0001");
  });

  it("keeps year/number from garbage lines without inventing a player", () => {
    const extract = extractStructuredFromOcr(
      spansFromTextBlock("2024 #8 Yer Ore Oo Ns\n1987 Prizm #1 Pmreianm We Kz Ie"),
    );
    expect(extract.player).toBeNull();
    expect(extract.year).toBe(2024);
    expect(["8", "1"]).toContain(extract.number);
  });

  it("reads a PaperStream sidecar caption without dumping leftover tokens", () => {
    const extract = extractStructuredFromOcr(
      spansFromTextBlock("1986 Topps Michael Jordan 57"),
    );
    expect(extract.player).toBe("Michael Jordan");
    expect(extract.year).toBe(1986);
    expect(extract.manufacturer).toBe("Topps");
    expect(extract.number).toBe("57");
  });
});

describe("profile-aware OCR", () => {
  it("treats Pokémon attack text as body and keeps HP out of the number", () => {
    const pokemon = getOcrProfile("pokemon");
    expect(classifyOcrLine("Flip a coin. If heads, this Pokemon is", pokemon)).toBe("body");
    const extract = extractStructuredFromOcr(
      spansFromTextBlock("Charizard\n4/102\n120 HP\nThe Pokémon Company", pokemon),
      pokemon,
    );
    expect(extract.player).toMatch(/Charizard/i);
    expect(extract.number).toBe("4/102");
    expect(privilegedOcrIsComplete(extract, pokemon)).toBe(true);
  });

  it("does not require a year for a complete TCG extract", () => {
    const mtg = getOcrProfile("mtg");
    const extract = extractStructuredFromOcr(
      spansFromTextBlock("Black Lotus\nLEA 232\nWizards of the Coast", mtg),
      mtg,
    );
    expect(extract.player).toMatch(/Black Lotus/i);
    expect(extract.number).toBe("LEA 232");
    expect(extract.year).toBeNull();
    expect(privilegedOcrIsComplete(extract, mtg)).toBe(true);
  });

  it("reads One Piece OP-set numbers and ignores DON/Life lines", () => {
    const op = getOcrProfile("one_piece");
    expect(classifyOcrLine("DON!! 2 Give this Leader +2000 power", op)).toBe("body");
    const extract = extractStructuredFromOcr(
      spansFromTextBlock("Monkey D Luffy\nOP01-003\nBandai One Piece", op),
      op,
    );
    expect(extract.player).toMatch(/Luffy/i);
    expect(extract.number).toBe("OP01-003");
  });
});
