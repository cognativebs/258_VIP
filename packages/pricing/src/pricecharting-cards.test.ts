import { describe, expect, it } from "vitest";
import {
  cardNumberKey,
  conditionRows,
  consoleSetKey,
  fmvFromHistory,
  matchBinderCard,
  parseProductName,
  setKeysFor,
} from "./pricecharting-cards.js";

const card = { externalId: "me2-125", name: "Mega Charizard X ex", setName: "Phantasmal Flames", number: "125" };
const c = (id: string, productName: string, consoleName = "Pokemon Phantasmal Flames") => ({ id, productName, consoleName });

describe("PriceCharting product names", () => {
  it("splits name, number and variant", () => {
    expect(parseProductName("Mega Charizard X ex #125")).toEqual({ name: "Mega Charizard X ex", number: "125", variant: null });
    expect(parseProductName("Reshiram & Charizard GX [Jumbo] #SM247")).toEqual({ name: "Reshiram & Charizard GX", number: "SM247", variant: "Jumbo" });
    expect(cardNumberKey("088/165")).toBe("88");
    expect(cardNumberKey("SM247")).toBe("sm247");
    expect(consoleSetKey("Pokemon Japanese Scarlet & Violet 151")).toEqual({ setKey: "japanese-scarlet-violet-151", language: "other" });
    expect(setKeysFor("SM Black Star Promos")).toEqual(["sm-black-star-promos", "promo"]);
    expect(setKeysFor("151")).toEqual(["151", "scarlet-violet-151"]);
  });
});

describe("matchBinderCard", () => {
  it("prices only one exact English set + number + name match", () => {
    const m = matchBinderCard(card, [c("1", "Mega Charizard X ex #130"), c("2", "Mega Charizard X ex #125"), c("3", "Mega Charizard X Ex Ultra-Premium Collection")]);
    expect(m).toMatchObject({ productId: "2", method: "exact_name", needsReview: false, confidence: 0.95 });
  });

  it("finds promos and 151 under PriceCharting's set names, never a Japanese printing", () => {
    expect(
      matchBinderCard({ externalId: "smp-SM247", name: "Reshiram & Charizard-GX", setName: "SM Black Star Promos", number: "SM247" }, [
        c("j", "Reshiram & Charizard GX [Jumbo] #SM247", "Pokemon Promo"),
        c("p", "Reshiram & Charizard GX #SM247", "Pokemon Promo"),
      ]),
    ).toMatchObject({ productId: "p", method: "exact_name" });
    expect(
      matchBinderCard({ externalId: "sv3pt5-40", name: "Wigglytuff ex", setName: "151", number: "40" }, [
        c("jp", "Wigglytuff EX #40", "Pokemon Japanese Scarlet & Violet 151"),
        c("en", "Wigglytuff ex #40", "Pokemon Scarlet & Violet 151"),
      ]),
    ).toMatchObject({ productId: "en", method: "exact_name" });
  });

  it("sends doubtful matches to review and refuses other sets", () => {
    expect(matchBinderCard(card, [c("v", "Mega Charizard X ex [Reverse Holo] #125")])).toMatchObject({ method: "trgm", needsReview: true });
    expect(matchBinderCard(card, [c("a", "Mega Charizard X ex #125"), c("b", "Mega Charizard X ex #125")])).toMatchObject({ needsReview: true });
    expect(matchBinderCard(card, [c("n", "Mega Charizard X ex #13")])).toMatchObject({ method: "trgm", confidence: 0.4, needsReview: true });
    expect(matchBinderCard(card, [c("o", "Mega Charizard X ex #125", "Pokemon Surging Sparks")])).toMatchObject({ productId: null, method: "unmatched" });
  });
});

describe("condition rows and FMV", () => {
  it("writes one row per priced column; ungraded is NM assumed; zero is absence", () => {
    expect(conditionRows({ ungraded: 17, grade9: 0, psa10: 107.3, sgc10: null })).toEqual([
      { condition: "NM", conditionAssumed: true, price: 17 },
      { condition: "PSA_10", conditionAssumed: false, price: 107.3 },
    ]);
  });

  it("ranges stored snapshots in the window, never invents a spread, and caps confidence at 0.75", () => {
    const asOf = new Date("2026-10-05T12:00:00Z");
    const rows = [
      { condition: "NM", conditionAssumed: true, observedOn: "2026-10-05", price: 17 },
      { condition: "NM", conditionAssumed: true, observedOn: "2026-10-01", price: 15 },
      { condition: "NM", conditionAssumed: true, observedOn: "2026-09-25", price: 19 },
      { condition: "NM", conditionAssumed: true, observedOn: "2026-08-01", price: 99 },
      { condition: "PSA_10", conditionAssumed: false, observedOn: "2026-09-20", price: 107 },
    ];
    const [nm, psa] = fmvFromHistory(rows, { asOf });
    expect(nm).toMatchObject({ condition: "NM", low: 15, high: 19, latest: 17, snapshots: 3, recencyDays: 0, confidence: 0.75, evidenceClass: "vendor_guide" });
    expect(nm!.note).toMatch(/NM assumed · unverified\. Not sold comps\./);
    expect(psa).toMatchObject({ low: 107, high: 107, snapshots: 1, recencyDays: 15 });
    expect(psa!.confidence).toBeLessThan(0.6);
  });
});
