import { describe, expect, it } from "vitest";
import {
  conditionKeyFromTitle,
  huntAlertBand,
  huntSearchQuery,
  huntTitleMatch,
  isAlertable,
  isLotTitle,
} from "./hunt-market.js";

const coverE = {
  series: "Midnight Spider-Man",
  issue: "1",
  coverLetter: "E",
  variantName: "Jeehyung Lee Midnight Gallery",
  artist: "Jeehyung Lee",
  ratio: "1:25",
};
const coverA = { series: "Midnight Spider-Man", issue: "1", coverLetter: "A", variantName: "Regular / Cloaked", artist: null, ratio: null };
const virginG = { series: "Midnight Fantastic Four", issue: "1", coverLetter: "G", variantName: "Ben Harvey Virgin", artist: "Ben Harvey", ratio: "1:50" };

describe("hunt market rules", () => {
  it("asks eBay for series, issue and cover", () => {
    expect(huntSearchQuery(coverE)).toBe("Midnight Spider-Man #1 cover E");
    expect(huntSearchQuery({ series: "Absolute Batman", issue: "unknown" })).toBeNull();
  });

  it("calls a title strong only when it names this cover", () => {
    expect(huntTitleMatch(coverE, "Midnight Spider-Man #1 Jeehyung Lee 1:25 Variant NM")).toBe("strong");
    expect(huntTitleMatch(coverA, "MIDNIGHT SPIDER-MAN #1 COVER A Marvel 2026")).toBe("strong");
    expect(huntTitleMatch(coverA, "Midnight Spider-Man #1 Marvel 2026 NM")).toBe("weak");
    expect(huntTitleMatch(coverA, "Midnight Spider-Man #1 Cover A Virgin")).toBe("weak");
    expect(huntTitleMatch(virginG, "Midnight Fantastic Four #1 Ben Harvey 1:50 Virgin")).toBe("strong");
    expect(huntTitleMatch(coverA, "Midnight X-Men #1 Cover A")).toBe("none");
    expect(huntTitleMatch(coverA, "Midnight Spider-Man #2 Cover A")).toBe("none");
  });

  it("reads graded and lot titles", () => {
    expect(conditionKeyFromTitle("Midnight Spider-Man #1 CGC 9.8")).toBe("graded");
    expect(conditionKeyFromTitle("Midnight Spider-Man #1 NM")).toBe("any");
    expect(isLotTitle("Midnight Spider-Man #1 lot of 3 covers")).toBe(true);
    expect(isLotTitle("Midnight Spider-Man #1 Cover A")).toBe(false);
  });

  it("bands an ask by the item's price bands, or BUY under target when it has none", () => {
    const bands = [
      { label: "HIGH_PRIORITY" as const, upTo: 80, inclusive: true },
      { label: "BUY" as const, upTo: 100, inclusive: true },
      { label: "WATCH" as const, upTo: 125, inclusive: true },
    ];
    expect(huntAlertBand({ priceBands: bands, targetPrice: 100 }, 75)).toBe("HIGH_PRIORITY");
    expect(huntAlertBand({ priceBands: bands, targetPrice: 100 }, 130)).toBeNull();
    expect(huntAlertBand({ priceBands: [], targetPrice: 4 }, 3.5)).toBe("BUY");
    expect(huntAlertBand({ priceBands: [], targetPrice: null }, 1)).toBeNull();
  });

  it("alerts only on an exact, ungraded, single-book listing", () => {
    expect(isAlertable({ titleMatch: "strong", conditionKey: "any", isLot: false })).toBe(true);
    expect(isAlertable({ titleMatch: "weak", conditionKey: "any", isLot: false })).toBe(false);
    expect(isAlertable({ titleMatch: "strong", conditionKey: "graded", isLot: false })).toBe(false);
    expect(isAlertable({ titleMatch: "strong", conditionKey: "raw", isLot: true })).toBe(false);
  });
});
