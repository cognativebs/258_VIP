import { scoreFlipDeal } from "./flip-score.js";
import type { DealerCategory, FlipDealInput, FlipDealResult } from "./schemas.js";

const AS_OF = new Date("2026-09-13T15:00:00Z");

function d(daysAgo: number): Date {
  return new Date(AS_OF.getTime() - daysAgo * 86400000);
}

function comps(source: string, prices: { p: number; ago: number }[]) {
  return prices.map((x, i) => ({
    id: `${source}-${i}`,
    price: x.p,
    saleDate: d(x.ago),
    source,
    title: `${source} sold`,
  }));
}

/**
 * Teaching snapshots — not live PriceCharting guide prints.
 * Each row carries a PriceCharting / SportsCardsPro product id so a paid
 * token can refresh condition values. Comp dollars are labeled manual.
 */
export type FlipExample = {
  id: string;
  headline: string;
  pricecharting: { host: "pricecharting" | "sportscardspro"; id: string; query: string };
  input: FlipDealInput;
  whyItMatters: string;
};

export const FLIP_EXAMPLES: FlipExample[] = [
  {
    id: "jordan-rc",
    headline: "1986 Fleer Michael Jordan #57 raw",
    pricecharting: { host: "sportscardspro", id: "72584", query: "michael jordan 1986 fleer 57" },
    input: {
      assetId: "jordan-1986-fleer-57",
      assetName: "1986 Fleer Michael Jordan #57 (raw)",
      category: "sports" satisfies DealerCategory,
      ageYears: 40,
      popCount: 312,
      listingPrice: 3600,
      gradingCost: 0,
      shippingCost: 25,
      comps: comps("ebay-sold", [
        { p: 5200, ago: 12 },
        { p: 5800, ago: 28 },
        { p: 4900, ago: 41 },
        { p: 5400, ago: 55 },
      ]),
      asOf: AS_OF,
      notes: "Raw, honest centering. Not a PSA 10 hope-and-pray.",
    },
    whyItMatters: "Ask sits under a tight raw band. Pop 312 is the 10 census — do not confuse that with raw supply.",
  },
  {
    id: "charizard-unlimited",
    headline: "Base Set Charizard #4 unlimited",
    pricecharting: { host: "pricecharting", id: "630417", query: "charizard base set 4" },
    input: {
      assetId: "charizard-base-unlimited",
      assetName: "Pokémon Base Set Charizard #4 (unlimited, raw)",
      category: "tcg",
      ageYears: 27,
      popCount: 18400,
      listingPrice: 420,
      gradingCost: 79.99,
      shippingCost: 18,
      comps: comps("ebay-sold", [
        { p: 240, ago: 8 },
        { p: 260, ago: 19 },
        { p: 255, ago: 33 },
        { p: 248, ago: 47 },
      ]),
      asOf: AS_OF,
      notes: "Seller wants you to 'just send it to PSA'. Unlimited 9s are a warehouse.",
    },
    whyItMatters: "Classic trap: pay over raw comps, then add Priority fees, into a 18k pop.",
  },
  {
    id: "asm-1",
    headline: "Amazing Spider-Man #1 (1963)",
    pricecharting: { host: "pricecharting", id: "2314818", query: "amazing spider-man 1 1963" },
    input: {
      assetId: "asm-1-1963",
      assetName: "Amazing Spider-Man #1 (1963) GD/VG candidate",
      category: "comics",
      ageYears: 63,
      popCount: 42,
      listingPrice: 21000,
      gradingCost: 0,
      shippingCost: 40,
      comps: comps("gocollect", [
        { p: 19000, ago: 21 },
        { p: 24000, ago: 44 },
        { p: 21500, ago: 70 },
      ]),
      asOf: AS_OF,
      notes: "Low-grade key. 9.8 pop is irrelevant to this copy.",
    },
    whyItMatters: "In-band on a thin key. Hold — you are not being paid to take restoration risk.",
  },
  {
    id: "mantle-52",
    headline: "1952 Topps Mickey Mantle #311",
    pricecharting: { host: "sportscardspro", id: "1821843", query: "mickey mantle 1952 topps 311" },
    input: {
      assetId: "mantle-1952-topps-311",
      assetName: "1952 Topps Mickey Mantle #311 (low grade)",
      category: "sports",
      ageYears: 74,
      popCount: 88,
      listingPrice: 185000,
      gradingCost: 0,
      shippingCost: 80,
      comps: comps("pwcc", [
        { p: 95000, ago: 18 },
        { p: 110000, ago: 39 },
        { p: 102000, ago: 61 },
      ]),
      asOf: AS_OF,
      notes: "Estate-sale sticker energy. The comps are the same grade, not a PSA 4 dream.",
    },
    whyItMatters: "Ask is ~2× the sold band. Famous card ≠ automatic deal.",
  },
  {
    id: "alpha-lotus",
    headline: "Alpha Black Lotus",
    pricecharting: { host: "pricecharting", id: "2244625", query: "black lotus alpha" },
    input: {
      assetId: "alpha-black-lotus",
      assetName: "Magic: The Gathering Alpha Black Lotus",
      category: "tcg",
      ageYears: 33,
      popCount: 19,
      listingPrice: 280000,
      gradingCost: 0,
      shippingCost: 120,
      comps: comps("ebay-sold", [
        { p: 260000, ago: 25 },
        { p: 310000, ago: 52 },
        { p: 275000, ago: 81 },
      ]),
      asOf: AS_OF,
      notes: "In-band, illiquid. One buyer at a time.",
    },
    whyItMatters: "Hold. You can be right on price and still wait a year for the next check.",
  },
  {
    id: "hulk-181",
    headline: "Incredible Hulk #181 (1974)",
    pricecharting: { host: "pricecharting", id: "2386994", query: "incredible hulk 181 1974" },
    input: {
      assetId: "hulk-181-1974",
      assetName: "The Incredible Hulk #181 (1974) raw",
      category: "comics",
      ageYears: 52,
      popCount: 2100,
      listingPrice: 140,
      gradingCost: 0,
      shippingCost: 16,
      comps: comps("ebay-sold", [
        { p: 240, ago: 9 },
        { p: 260, ago: 22 },
        { p: 220, ago: 36 },
        { p: 250, ago: 58 },
      ]),
      asOf: AS_OF,
      notes: "Raw VF-looking copy. 9.8 census is fat — this is a raw flip, not a gem submission.",
    },
    whyItMatters: "Buy the book, skip the slab. Discount to raw solds is the whole trade.",
  },
  {
    id: "lebron-chrome",
    headline: "2003 Topps Chrome LeBron #111",
    pricecharting: { host: "sportscardspro", id: "146424", query: "lebron james 2003 topps chrome 111" },
    input: {
      assetId: "lebron-2003-chrome-111",
      assetName: "2003 Topps Chrome LeBron James #111 raw",
      category: "sports",
      ageYears: 23,
      popCount: 5400,
      listingPrice: 505,
      gradingCost: 0,
      shippingCost: 15,
      comps: comps("ebay-sold", [
        { p: 480, ago: 11 },
        { p: 560, ago: 27 },
        { p: 510, ago: 40 },
      ]),
      asOf: AS_OF,
      notes: "In-band raw. PSA 10 pop is the reason the gem premium is not a plan.",
    },
    whyItMatters: "Hold / pass on grading. You are buying a liquid raw card, not a 10 ticket.",
  },
  {
    id: "blue-eyes-lob",
    headline: "Blue-Eyes White Dragon LOB-001",
    pricecharting: { host: "pricecharting", id: "2530559", query: "blue-eyes white dragon lob-001" },
    input: {
      assetId: "blue-eyes-lob-unlimited",
      assetName: "Yu-Gi-Oh Blue-Eyes White Dragon LOB-001 (unlimited)",
      category: "tcg",
      ageYears: 24,
      popCount: 8900,
      listingPrice: 95,
      gradingCost: 20,
      shippingCost: 12,
      comps: comps("ebay-sold", [
        { p: 42, ago: 6 },
        { p: 48, ago: 17 },
        { p: 55, ago: 29 },
        { p: 44, ago: 51 },
      ]),
      asOf: AS_OF,
      notes: "Unlimited, not 1st. Seller priced it like nostalgia, not print.",
    },
    whyItMatters: "Pass. Name the print or you overpay. 1st Edition is a different SKU (id 2530687).",
  },
  {
    id: "charizard-1st",
    headline: "Base Set Charizard #4 1st Edition",
    pricecharting: { host: "pricecharting", id: "715593", query: "charizard base set 1st edition 4" },
    input: {
      assetId: "charizard-base-1st",
      assetName: "Pokémon Base Set Charizard #4 [1st Edition] raw",
      category: "tcg",
      ageYears: 27,
      popCount: 164,
      listingPrice: 7200,
      gradingCost: 0,
      shippingCost: 30,
      comps: comps("ebay-sold", [
        { p: 11200, ago: 14 },
        { p: 12800, ago: 31 },
        { p: 10900, ago: 49 },
        { p: 12100, ago: 66 },
      ]),
      asOf: AS_OF,
      notes: "Authentic 1st stamp, unlimited-looking wear. Authenticate the stamp before wiring.",
    },
    whyItMatters: "Buy now on raw vs a real 1st band — after you have named the print.",
  },
  {
    id: "prismatic-etb",
    headline: "Prismatic Evolutions ETB (sealed)",
    pricecharting: { host: "pricecharting", id: "8256647", query: "prismatic evolutions elite trainer box" },
    input: {
      assetId: "prismatic-etb-sealed",
      assetName: "Pokémon Prismatic Evolutions Elite Trainer Box (sealed)",
      category: "sealed",
      ageYears: 1,
      popCount: 50000,
      listingPrice: 89,
      gradingCost: 0,
      shippingCost: 10,
      comps: comps("ebay-sold", [
        { p: 52, ago: 3 },
        { p: 48, ago: 7 },
        { p: 55, ago: 11 },
        { p: 50, ago: 16 },
      ]),
      asOf: AS_OF,
      notes: "LCS still asking allocation-week money after the reprint wave.",
    },
    whyItMatters: "Pass. Modern sealed after the chase window is how rooms fill with dead cardboard.",
  },
];

export function runFlipExamples(): { example: FlipExample; result: FlipDealResult }[] {
  return FLIP_EXAMPLES.map((example) => ({
    example,
    result: scoreFlipDeal(example.input),
  }));
}
