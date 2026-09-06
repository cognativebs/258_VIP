import { describe, expect, it } from "vitest";
import {
  classifyOcrLine,
  extractStructuredFromOcr,
  spansFromTextBlock,
} from "./classifyOcr.js";

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
