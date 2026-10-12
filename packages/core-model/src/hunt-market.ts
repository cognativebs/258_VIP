import { z } from "zod";
import { HuntPriceBandSchema, priceBandFor, type HuntPriceBand } from "./hunts.js";

/**
 * HUNT market slice, part 1: eBay asks for hunt items and price-band alerts. Asks are
 * observations, never market value; low ask and counts are computed from the latest check.
 */
export const HUNT_MARKET_RULE = "hunt-market@0.1.0";

export const HuntTitleMatchSchema = z.enum(["strong", "weak", "none"]);
export type HuntTitleMatch = z.infer<typeof HuntTitleMatchSchema>;

export const HuntConditionKeySchema = z.enum(["raw", "graded", "any"]);
export type HuntConditionKey = z.infer<typeof HuntConditionKeySchema>;

export type HuntMarketItemDetails = {
  series?: unknown;
  issue?: unknown;
  coverLetter?: unknown;
  variantName?: unknown;
  artist?: unknown;
  ratio?: unknown;
};

export const HuntAskSchema = z.object({
  listingId: z.string(),
  askPrice: z.number().positive(),
  title: z.string(),
  url: z.string().nullable(),
  conditionKey: HuntConditionKeySchema,
  titleMatch: HuntTitleMatchSchema,
  isLot: z.boolean(),
});
export type HuntAsk = z.infer<typeof HuntAskSchema>;

export const HuntItemMarketSchema = z.object({
  checkedAt: z.string().nullable(),
  /** Listings from the latest check that name this exact book (strong title match, raw, not a lot). */
  strongCount: z.number().int().nonnegative(),
  listingCount: z.number().int().nonnegative(),
  /** Lowest strong ask from the latest check. An asking price, not a market value. */
  lowStrongAsk: z.number().positive().nullable(),
  alerts: z.array(
    z.object({
      id: z.string(),
      band: HuntPriceBandSchema.shape.label,
      askPrice: z.number().positive(),
      title: z.string().nullable(),
      url: z.string().nullable(),
      status: z.enum(["new", "seen", "dismissed"]),
      createdAt: z.string(),
      /** Other open listings in the same item + band, folded into this alert. */
      similarCount: z.number().int().nonnegative(),
    }),
  ),
  ruleVersion: z.literal(HUNT_MARKET_RULE),
  verification: z.literal("unverified"),
});
export type HuntItemMarket = z.infer<typeof HuntItemMarketSchema>;

function words(s: string): string {
  return ` ${s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9:]+/g, " ")
    .trim()} `;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "Midnight Spider-Man #1 Cover B" — what eBay is asked for. */
export function huntSearchQuery(d: HuntMarketItemDetails): string | null {
  const series = str(d.series);
  const issue = str(d.issue);
  if (!series || !issue || issue === "unknown") return null;
  const cover = str(d.coverLetter);
  const variant = str(d.variantName);
  const extra = cover ? `cover ${cover}` : variant ?? "";
  return `${series} #${issue} ${extra}`.trim();
}

const GRADED = /\b(cgc|cbcs|pgx|graded|slab|slabbed)\b/;
const LOT = /\b(lot|set of|bundle|run|complete set|\d+\s*(?:book|comic)s?)\b/;
const DISTINCT_VARIANT_WORDS = ["virgin", "homage", "connecting", "bloodbath", "gallery", "foil", "sketch", "exclusive"];

export function conditionKeyFromTitle(title: string): HuntConditionKey {
  return GRADED.test(words(title)) ? "graded" : /\braw\b/.test(words(title)) ? "raw" : "any";
}

export function isLotTitle(title: string): boolean {
  return LOT.test(words(title));
}

/**
 * strong: series + issue + something that names this cover (cover letter, artist, ratio or a
 * distinctive variant word) and no distinctive word of a different variant (a "virgin" title is
 * not the trade cover). weak: series + issue only. none: the series or issue is missing.
 */
export function huntTitleMatch(d: HuntMarketItemDetails, title: string): HuntTitleMatch {
  const t = words(title);
  const series = str(d.series);
  const issue = str(d.issue);
  if (!series || !issue) return "none";
  const seriesWords = words(series).trim().split(" ").filter((w) => w.length > 1);
  if (!seriesWords.every((w) => t.includes(` ${w} `))) return "none";
  const issueRe = new RegExp(`(?:^|\\s)(?:#\\s*|no\\s*)?0*${issue.replace(/[^a-z0-9]/gi, "")}(?:\\s|$)`, "i");
  if (!issueRe.test(t) && !title.includes(`#${issue}`)) return "none";

  const variant = words(str(d.variantName) ?? "");
  const wantDistinct = DISTINCT_VARIANT_WORDS.filter((w) => variant.includes(` ${w} `));
  const hasOtherDistinct = DISTINCT_VARIANT_WORDS.some((w) => !wantDistinct.includes(w) && t.includes(` ${w} `));
  if (hasOtherDistinct) return "weak";

  const cover = str(d.coverLetter)?.toLowerCase();
  const artistLast = str(d.artist)?.split(/\s+/).pop();
  const ratio = str(d.ratio);
  const names =
    (cover && new RegExp(`\\b(cover|cvr|variant|var)\\s*${cover}\\b|\\b${cover}\\s*(cover|cvr)\\b`).test(t)) ||
    (artistLast && t.includes(` ${words(artistLast).trim()} `)) ||
    (ratio && t.includes(` ${ratio.toLowerCase()} `)) ||
    (wantDistinct.length > 0 && wantDistinct.every((w) => t.includes(` ${w} `)));
  return names ? "strong" : "weak";
}

/** Band the ask falls in: the item's price bands when set, else BUY at or under its target. */
export function huntAlertBand(
  item: { priceBands: ReadonlyArray<HuntPriceBand>; targetPrice: number | null },
  ask: number,
): HuntPriceBand["label"] | null {
  if (item.priceBands.length) return priceBandFor(item.priceBands, ask);
  if (item.targetPrice != null && ask <= item.targetPrice) return "BUY";
  return null;
}

export const HuntAlertPatchSchema = z.object({ status: z.enum(["new", "seen", "dismissed"]) }).strict();
export type HuntAlertPatch = z.infer<typeof HuntAlertPatchSchema>;

/** Alerts only for a listing that names this exact book, ungraded, and not a lot. */
export function isAlertable(ask: Pick<HuntAsk, "titleMatch" | "conditionKey" | "isLot">): boolean {
  return ask.titleMatch === "strong" && ask.conditionKey !== "graded" && !ask.isLot;
}
