import { describe, expect, it } from "vitest";
import {
  binderMediaUrl,
  pokemontcgImageUrl,
  printedTcgName,
  resolveTcgCover,
} from "./tcgPresentation.js";

describe("pokemontcgImageUrl", () => {
  it("maps base1-4 to the official CDN small image", () => {
    expect(pokemontcgImageUrl("base1-4")).toBe("https://images.pokemontcg.io/base1/4.png");
  });

  it("keeps alphanumeric set codes and numbers with letters", () => {
    expect(pokemontcgImageUrl("sv3-198")).toBe("https://images.pokemontcg.io/sv3/198.png");
    expect(pokemontcgImageUrl("base1-4a")).toBe("https://images.pokemontcg.io/base1/4a.png");
  });

  it("returns null when the id has no set/number split", () => {
    expect(pokemontcgImageUrl("")).toBeNull();
    expect(pokemontcgImageUrl("base1")).toBeNull();
  });
});

describe("resolveTcgCover", () => {
  it("prefers an explicit Binder image_url", () => {
    expect(
      resolveTcgCover({
        coverImageUrl: "https://images.pokemontcg.io/base1/4_hires.png",
        externalIds: [{ source: "pokemontcg", externalValue: "base1-4" }],
      }),
    ).toBe("https://images.pokemontcg.io/base1/4_hires.png");
  });

  it("falls back to the official CDN from a pokemontcg id", () => {
    expect(
      resolveTcgCover({
        coverImageUrl: null,
        externalIds: [{ source: "pokemontcg", externalValue: "base1-4" }],
      }),
    ).toBe("https://images.pokemontcg.io/base1/4.png");
  });

  it("builds a Binder media URL for local uploads", () => {
    expect(binderMediaUrl("scan-1.png", "http://127.0.0.1:3010")).toBe(
      "http://127.0.0.1:3010/api/media/scan-1.png",
    );
    expect(
      resolveTcgCover({
        imageLocal: "scan-1.png",
        binderPublicUrl: "http://127.0.0.1:3010",
      }),
    ).toBe("http://127.0.0.1:3010/api/media/scan-1.png");
  });
});

describe("printedTcgName", () => {
  it("does not treat the set as the card", () => {
    expect(
      printedTcgName({
        cardName: null,
        assetName: "Base Set #4 Charizard Holo",
        series: "Base Set",
        issue: "4",
      }),
    ).toBe("Charizard Holo");
  });

  it("returns null instead of Unnamed card", () => {
    expect(
      printedTcgName({
        cardName: "Unnamed card",
        assetName: "Base Set #4 Unnamed card",
        series: "Base Set",
        issue: "4",
      }),
    ).toBeNull();
  });
});
