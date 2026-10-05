/**
 * PriceCharting for Pokémon cards (pure). Matching a Binder card to a
 * PriceCharting product, turning a product's condition columns into
 * card_price_history rows, and reading a fair-market-value range back.
 *
 * PriceCharting values are a vendor guide derived from completed sales — not
 * individual sold comps (ADR 0012: vendor_derived, confidence ≤ 0.75). Its
 * 7 / 8 / 9 / 9.5 columns are any grading company; only the 10s are named.
 * The ungraded column is stored as NM with condition_assumed = true
 * ("NM assumed · unverified"), never as a verified grade.
 */
import { z } from "zod";

export const PRICECHARTING_CARDS_VERSION = "pricecharting-pokemon-cards@0.1.0";
export const PRICECHARTING_PRICE_SOURCE = "pricecharting";
/** ADR 0012 cap for a vendor-derived value. */
export const VENDOR_GUIDE_CONFIDENCE_CAP = 0.75;

/** card_price_history.condition values written from PriceCharting columns. */
export const PRICECHARTING_CONDITIONS = [
  { column: "ungraded", condition: "NM", assumed: true },
  { column: "grade7", condition: "GRADE_7", assumed: false },
  { column: "grade8", condition: "GRADE_8", assumed: false },
  { column: "grade9", condition: "GRADE_9", assumed: false },
  { column: "grade95", condition: "GRADE_9_5", assumed: false },
  { column: "psa10", condition: "PSA_10", assumed: false },
  { column: "bgs10", condition: "BGS_10", assumed: false },
  { column: "cgc10", condition: "CGC_10", assumed: false },
  { column: "sgc10", condition: "SGC_10", assumed: false },
] as const;
export type PriceChartingCondition = (typeof PRICECHARTING_CONDITIONS)[number]["condition"];

const key = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** "Mega Charizard X ex #125" → name, number "125"; "Charizard [Reverse Holo] #4" → variant "Reverse Holo". */
export function parseProductName(productName: string): { name: string; number: string | null; variant: string | null } {
  const variant = /\[([^\]]+)\]/.exec(productName)?.[1]?.trim() ?? null;
  const number = /#\s*([A-Za-z0-9-]+)\s*$/.exec(productName)?.[1] ?? null;
  const name = productName
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/#\s*[A-Za-z0-9-]+\s*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { name, number, variant };
}

/** "Pokemon Phantasmal Flames" → "phantasmal-flames"; Japanese and other-language consoles are not English cards. */
export function consoleSetKey(consoleName: string): { setKey: string; language: "en" | "other" } {
  const rest = consoleName.replace(/^pok[eé]mon\s+/i, "");
  const other = /^(japanese|chinese|korean|german|french|italian|spanish|portuguese)\b/i.test(rest);
  return { setKey: key(rest), language: other ? "other" : "en" };
}

/** "088" and "88/165" both compare as "88"; letter prefixes (TG12, SV049) keep their letters. */
export function cardNumberKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const head = raw.split("/")[0]!.trim().toLowerCase();
  const m = /^([a-z]*)0*(\d+)([a-z]*)$/.exec(head);
  return m ? `${m[1]}${m[2]}${m[3]}` : head || null;
}

export type BinderCard = { externalId: string; name: string; setName: string; number: string | null };
export type ProductCandidate = { id: string; productName: string; consoleName: string };

export const CardMatchSchema = z
  .object({
    productId: z.string().nullable(),
    productName: z.string().nullable(),
    method: z.enum(["exact_name", "trgm", "unmatched"]),
    confidence: z.number().min(0).max(1),
    needsReview: z.boolean(),
    reason: z.string(),
  })
  .strict();
export type CardMatch = z.infer<typeof CardMatchSchema>;

/**
 * Exact = same English set, same card number, no variant bracket, and the
 * card's first name word in the product name. Exactly one exact match is
 * used; anything else is offered for review or left unmatched.
 */
/** Where PriceCharting files a set under another name: Black Star promos → "Pokemon Promo"; 151 → "Scarlet & Violet 151". */
export function setKeysFor(setName: string): string[] {
  const k = key(setName);
  if (k.endsWith("black-star-promos")) return [k, "promo"];
  if (k === "151") return [k, "scarlet-violet-151"];
  return [k];
}

export function matchBinderCard(card: BinderCard, candidates: ReadonlyArray<ProductCandidate>): CardMatch {
  const setKeys = setKeysFor(card.setName);
  const number = cardNumberKey(card.number);
  const firstWord = key(card.name).split("-")[0] ?? "";
  const scored = candidates.map((c) => {
    const p = parseProductName(c.productName);
    const cs = consoleSetKey(c.consoleName);
    return {
      c,
      p,
      sameSet: cs.language === "en" && setKeys.includes(cs.setKey),
      sameNumber: number != null && cardNumberKey(p.number) === number,
      nameHit: firstWord !== "" && key(p.name).split("-").includes(firstWord),
    };
  });
  const exact = scored.filter((s) => s.sameSet && s.sameNumber && s.nameHit && !s.p.variant);
  const pick = (s: (typeof scored)[number], method: CardMatch["method"], confidence: number, needsReview: boolean, reason: string): CardMatch =>
    CardMatchSchema.parse({ productId: s.c.id, productName: s.c.productName, method, confidence, needsReview, reason });

  if (exact.length === 1) return pick(exact[0]!, "exact_name", 0.95, false, "same set, number and name");
  if (exact.length > 1) return pick(exact[0]!, "trgm", 0.6, true, `${exact.length} products share this set and number`);
  const variantOnly = scored.find((s) => s.sameSet && s.sameNumber && s.nameHit);
  if (variantOnly) return pick(variantOnly, "trgm", 0.6, true, `only a variant matched: [${variantOnly.p.variant}]`);
  const setAndName = scored.find((s) => s.sameSet && s.nameHit);
  if (setAndName) return pick(setAndName, "trgm", 0.4, true, "same set and name, different number");
  return CardMatchSchema.parse({ productId: null, productName: null, method: "unmatched", confidence: 0, needsReview: true, reason: "no candidate in the same English set" });
}

export type ConditionPrices = Partial<Record<(typeof PRICECHARTING_CONDITIONS)[number]["column"], number | null>>;

/** One row per condition column PriceCharting priced. Zero and missing are absence, not $0. */
export function conditionRows(prices: ConditionPrices) {
  return PRICECHARTING_CONDITIONS.flatMap((c) => {
    const v = prices[c.column];
    return v != null && v > 0 ? [{ condition: c.condition, conditionAssumed: c.assumed, price: v }] : [];
  });
}

export const FmvRangeSchema = z
  .object({
    condition: z.string(),
    conditionAssumed: z.boolean(),
    low: z.number(),
    high: z.number(),
    latest: z.number(),
    latestOn: z.string(),
    snapshots: z.number().int().positive(),
    recencyDays: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(VENDOR_GUIDE_CONFIDENCE_CAP),
    evidenceClass: z.literal("vendor_guide"),
    note: z.string(),
  })
  .strict();
export type FmvRange = z.infer<typeof FmvRangeSchema>;

/**
 * Fair-market-value range per condition from stored guide snapshots in the
 * window: low/high across snapshots, the latest value, how many snapshots and
 * how old the newest is. Confidence starts at the vendor cap and falls with
 * staleness and with a single snapshot. A range of one snapshot is reported
 * as such, never widened by an invented spread.
 */
export function fmvFromHistory(
  rows: ReadonlyArray<{ condition: string; conditionAssumed: boolean; observedOn: string; price: number }>,
  opts: { asOf: Date; windowDays?: number },
): FmvRange[] {
  const windowDays = opts.windowDays ?? 30;
  const asOfDay = Date.UTC(opts.asOf.getUTCFullYear(), opts.asOf.getUTCMonth(), opts.asOf.getUTCDate());
  const byCondition = new Map<string, typeof rows[number][]>();
  for (const r of rows) {
    const age = (asOfDay - Date.parse(`${r.observedOn}T00:00:00Z`)) / 86_400_000;
    if (age < 0 || age > windowDays) continue;
    byCondition.set(r.condition, [...(byCondition.get(r.condition) ?? []), r]);
  }
  const out: FmvRange[] = [];
  for (const [condition, list] of byCondition) {
    const sorted = [...list].sort((a, b) => a.observedOn.localeCompare(b.observedOn));
    const latest = sorted.at(-1)!;
    const recencyDays = Math.round((asOfDay - Date.parse(`${latest.observedOn}T00:00:00Z`)) / 86_400_000);
    const staleness = Math.max(0, 1 - recencyDays / windowDays);
    const breadth = sorted.length >= 3 ? 1 : sorted.length === 2 ? 0.9 : 0.8;
    out.push(
      FmvRangeSchema.parse({
        condition,
        conditionAssumed: latest.conditionAssumed,
        low: Math.min(...sorted.map((r) => r.price)),
        high: Math.max(...sorted.map((r) => r.price)),
        latest: latest.price,
        latestOn: latest.observedOn,
        snapshots: sorted.length,
        recencyDays,
        confidence: Math.round(VENDOR_GUIDE_CONFIDENCE_CAP * breadth * (0.5 + 0.5 * staleness) * 1000) / 1000,
        evidenceClass: "vendor_guide",
        note: `PriceCharting guide (sale-derived), ${sorted.length} snapshot${sorted.length === 1 ? "" : "s"} in ${windowDays}d${latest.conditionAssumed ? "; NM assumed · unverified" : ""}. Not sold comps.`,
      }),
    );
  }
  const order = PRICECHARTING_CONDITIONS.map((c) => c.condition as string);
  return out.sort((a, b) => order.indexOf(a.condition) - order.indexOf(b.condition));
}
