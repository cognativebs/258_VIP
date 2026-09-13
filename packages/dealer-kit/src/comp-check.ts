import type { CompRedFlag, CompSource } from "./schemas.js";
import { COMP_CHECK_VERSION } from "./version.js";

/**
 * Field order for a 90-second check. PriceCharting is last on purpose:
 * it is a guide (current condition values), not a sold ledger.
 */
export const COMP_SOURCES: CompSource[] = [
  {
    order: 1,
    id: "ebay-sold",
    name: "eBay Sold + Completed",
    url: "https://www.ebay.com/sch/i.html?LH_Sold=1&LH_Complete=1",
    useFor: "Real money that changed hands in the last 30–90 days. Filter Sold, not Active.",
    caveat: "Ignore best-offer listings with no sold stamp. One outlier auction is not a market.",
  },
  {
    order: 2,
    id: "130point",
    name: "130point",
    url: "https://130point.com/sales/",
    useFor: "eBay sold search that actually works on mobile at a table.",
    caveat: "Still eBay. Same solds, faster UI. Not a second independent market.",
  },
  {
    order: 3,
    id: "pwcc",
    name: "PWCC Marketplace",
    url: "https://www.pwccmarketplace.com/",
    useFor: "Graded sports + TCG with auction history. Use when the copy is already slabbed.",
    caveat: "Buyer premium is real. Hammer ≠ take-home. Premiums run ~20%.",
  },
  {
    order: 4,
    id: "gocollect",
    name: "GoCollect",
    url: "https://gocollect.com/",
    useFor: "Comics census + CGC/CBCS solds. Best for keys, not dollar books.",
    caveat: "Guide-ish on thin issues. Prefer actual auction records over the index line.",
  },
  {
    order: 5,
    id: "pricecharting",
    name: "PriceCharting",
    url: "https://www.pricecharting.com/",
    useFor: "Fast condition ladder (raw / 7 / 8 / 9 / 9.5 / 10) for TCG, games, comics, sports (SportsCardsPro).",
    caveat:
      "API + site are current guide values, not historic solds. Use to sanity-check a band after eBay solds — never as the only number.",
  },
];

export const COMP_RED_FLAGS: CompRedFlag[] = [
  {
    id: "regraded-slab",
    title: "Regraded slab",
    tells: [
      "Fresh label on an older cert, or cert lookup shows a prior grade / different grader.",
      "Pristine case + dirty or yellowed card / book that does not match the number.",
      "Seller will not show the cert page, or the cert is 'pending'.",
      "Cross-over flip in the last 90 days at the same serial.",
    ],
    doInstead: "Open the cert on PSA/CGC/BGS before money moves. No cert page → walk.",
  },
  {
    id: "doctored-comic",
    title: "Doctored comic",
    tells: [
      "Color touch on spin/logo that looks too saturated vs the rest of the cover.",
      "Missing pieces 'pressed out' — page count off, or light shines through a fill.",
      "Suspect trim: razor-sharp edges on a book that should be worn.",
      "Seller says 'looks unrestored' but will not guarantee CGC Universal.",
    ],
    doInstead: "Price as restored until a grader says otherwise. Restored comps are a different market.",
  },
  {
    id: "reprint-tcg",
    title: "Reprint / proxy TCG",
    tells: [
      "Wrong back color, blurry holofoil, or a 1999 stamp on a card that should be shadowless / 1st.",
      "Too-thick or too-slick stock. Compare to a known authentic in-hand.",
      "Set symbol / copyright line does not match the claimed print.",
      "Price is 'too good' on a 1st Edition holos — those do not hide in $20 bins.",
    ],
    doInstead: "If you cannot name the print (1st / shadowless / unlimited / revision) you cannot price it. Pass.",
  },
];

export const COMP_CHECK_STEPS = [
  "Photo the asking price and the item. Do not rely on memory.",
  "Search eBay Sold for the exact print / grade / cert — 30s.",
  "Confirm on 130point if the phone eBay app is lying to you — 20s.",
  "If slabbed: open the cert. If comic: check restoration tells. If TCG: name the print — 20s.",
  "Glance PriceCharting / GoCollect only to see if your sold band is insane — 10s.",
  "Three solds inside 90 days that beat the ask → consider. Otherwise walk.",
] as const;

export const COMP_CHECK_META = {
  version: COMP_CHECK_VERSION,
  timeBudgetSeconds: 90,
  productPriceUsd: 12,
  title: "The 90-Second Comp Check",
} as const;
