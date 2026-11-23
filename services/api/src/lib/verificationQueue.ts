import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";

/**
 * Verification burn-down for owned comics.
 *
 * `needs_verification` is a permanent workflow state: this module only READS
 * it. The queue orders unverified books by value at risk so the operator clears
 * the expensive ones first, one human click at a time through the existing
 * POST /api/comics/holding/:id path. There is deliberately no bulk verify.
 *
 * Value at risk is the high end of the vendor guide range for the copy
 * (latest CovrPrice, ComicBase and PriceCharting-ungraded quotes, plus CLZ's
 * value). Vendor guides are not sold comps and are unverified.
 */
export const VERIFICATION_QUEUE_RULE = "vip-comics-verification-queue@0.1.0";
export const VERIFICATION_QUEUE_DEFAULT_LIMIT = 50;
export const VERIFICATION_QUEUE_MAX_LIMIT = 200;

/** clz_metadata key stamped by the comics write paths when an operator sets Needs Verification. */
export const VERIFICATION_MARKED_AT_KEY = "Verification Marked At";

export const GuideQuoteSchema = z
  .object({
    source: z.enum(["covrprice", "comicbase", "pricecharting", "clz"]),
    price: z.number().positive(),
    /** ISO date of the quote; null when the source carries none. */
    observedOn: z.string().nullable(),
  })
  .strict();
export type GuideQuote = z.infer<typeof GuideQuoteSchema>;

export const GuideRangeSchema = z
  .object({
    low: z.number().positive(),
    high: z.number().positive(),
    sourceCount: z.number().int().positive(),
    sources: z.array(GuideQuoteSchema.shape.source),
    recencyDays: z.number().int().nonnegative().nullable(),
    evidenceClass: z.literal("vendor_guide"),
    verificationStatus: z.literal("unverified"),
  })
  .strict()
  .refine((r) => r.high >= r.low, "high below low");
export type GuideRange = z.infer<typeof GuideRangeSchema>;

export const VerificationQueueItemSchema = z
  .object({
    /** source_row_id — the id the existing PATCH path takes. */
    id: z.string().min(1),
    title: z.string(),
    publisher: z.string().nullable(),
    isKeyIssue: z.boolean(),
    keyReason: z.string().nullable(),
    verificationNotes: z.string().nullable(),
    /** null when no guide quote exists: "no guide evidence", never a guessed value. */
    guideRange: GuideRangeSchema.nullable(),
    importedAt: z.string(),
    ageDays: z.number().int().nonnegative(),
    queuePosition: z.number().int().positive(),
  })
  .strict();
export type VerificationQueueItem = z.infer<typeof VerificationQueueItemSchema>;

export const VerificationCountsSchema = z
  .object({
    ownedTotal: z.number().int().nonnegative(),
    needsVerification: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    /** Marked verified by an operator click in the last 7 days (stamped by the write path). */
    verifiedThisWeek: z.number().int().nonnegative(),
    needsVerificationWithGuide: z.number().int().nonnegative(),
  })
  .strict();
export type VerificationCounts = z.infer<typeof VerificationCountsSchema>;

export const VerificationQueueResponseSchema = z
  .object({
    available: z.boolean(),
    error: z.string().nullable(),
    ruleOrModelVersion: z.string(),
    ordering: z.string(),
    note: z.string(),
    counts: VerificationCountsSchema,
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    items: z.array(VerificationQueueItemSchema),
  })
  .strict();
export type VerificationQueueResponse = z.infer<typeof VerificationQueueResponseSchema>;

export const VerificationQueueQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .catch(VERIFICATION_QUEUE_DEFAULT_LIMIT)
    .transform((n) => Math.min(n, VERIFICATION_QUEUE_MAX_LIMIT))
    .default(VERIFICATION_QUEUE_DEFAULT_LIMIT),
  offset: z.coerce.number().int().nonnegative().catch(0).default(0),
});

export const VERIFICATION_ORDERING =
  "guide range high end desc (no guide last) → key issue first → oldest import first";

/** Raw row the loader hands to the pure ranker. */
export type VerificationCandidate = {
  id: string;
  title: string;
  publisher: string | null;
  isKeyIssue: boolean;
  keyReason: string | null;
  verificationNotes: string | null;
  importedAt: Date;
  quotes: GuideQuote[];
};

const DAY_MS = 86_400_000;

export function guideRangeFromQuotes(quotes: GuideQuote[], now: Date = new Date()): GuideRange | null {
  const usable = quotes.filter((q) => Number.isFinite(q.price) && q.price > 0);
  if (!usable.length) return null;
  const prices = usable.map((q) => q.price);
  const dated = usable
    .map((q) => (q.observedOn ? new Date(q.observedOn).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const newest = dated.length ? Math.max(...dated) : null;
  return GuideRangeSchema.parse({
    low: Math.min(...prices),
    high: Math.max(...prices),
    sourceCount: usable.length,
    sources: usable.map((q) => q.source),
    recencyDays: newest == null ? null : Math.max(0, Math.floor((now.getTime() - newest) / DAY_MS)),
    evidenceClass: "vendor_guide",
    verificationStatus: "unverified",
  });
}

/** Value at risk first, then key issues, then age. Pure so the order is testable without Postgres. */
export function rankVerificationQueue(
  candidates: VerificationCandidate[],
  now: Date = new Date(),
): VerificationQueueItem[] {
  return candidates
    .map((c) => ({ c, range: guideRangeFromQuotes(c.quotes, now) }))
    .sort((a, b) => {
      const ah = a.range?.high ?? -1;
      const bh = b.range?.high ?? -1;
      if (ah !== bh) return bh - ah;
      if (a.c.isKeyIssue !== b.c.isKeyIssue) return a.c.isKeyIssue ? -1 : 1;
      const at = a.c.importedAt.getTime();
      const bt = b.c.importedAt.getTime();
      if (at !== bt) return at - bt;
      return a.c.id.localeCompare(b.c.id);
    })
    .map(({ c, range }, index) =>
      VerificationQueueItemSchema.parse({
        id: c.id,
        title: c.title,
        publisher: c.publisher,
        isKeyIssue: c.isKeyIssue,
        keyReason: c.keyReason,
        verificationNotes: c.verificationNotes,
        guideRange: range,
        importedAt: c.importedAt.toISOString(),
        ageDays: Math.max(0, Math.floor((now.getTime() - c.importedAt.getTime()) / DAY_MS)),
        queuePosition: index + 1,
      }),
    );
}

const OWNED = sql`
  h.source = 'clz_import'
  AND h.dropped_at IS NULL
  AND h.sold_at IS NULL
  AND COALESCE(h.sales_path_state, 'available') <> 'sold'
  AND COALESCE(h.quantity, 1) > 0
`;

const CANDIDATES_SQL = sql`
  SELECT
      h.source_row_id,
      h.imported_at,
      h.verification_notes,
      h.current_price_snapshot,
      h.clz_metadata->>'Current Price' AS clz_meta_price,
      h.clz_metadata->>'Is Key Comic'  AS clz_key,
      h.clz_metadata->>'Key Comic Reason' AS clz_key_reason,
      s.title AS series_title,
      s.publisher,
      i.issue_number,
      i.is_key_issue,
      i.key_reason,
      v.cover_label,
      cv.guide_price AS covrprice_price, cv.snapshot_on AS covrprice_on,
      cb.guide_price AS comicbase_price, cb.snapshot_on AS comicbase_on,
      pc.guide_price AS pricecharting_price, pc.snapshot_on AS pricecharting_on
  FROM vault_collection.holding h
  JOIN vault_core.asset a    ON a.id = h.asset_id
  JOIN vault_comic.variant v ON v.asset_id = a.id
  JOIN vault_comic.issue i   ON i.id = v.issue_id
  JOIN vault_comic.series s  ON s.id = i.series_id
  LEFT JOIN LATERAL (
      SELECT g.guide_price, g.snapshot_on FROM vault_market.guide_price_observation g
      WHERE g.holding_source_row_id = h.source_row_id
        AND g.source = 'covrprice' AND g.observation_kind = 'guide_quote'
      ORDER BY g.snapshot_on DESC LIMIT 1
  ) cv ON TRUE
  LEFT JOIN LATERAL (
      SELECT g.guide_price, g.snapshot_on FROM vault_market.guide_price_observation g
      WHERE g.holding_source_row_id = h.source_row_id
        AND g.source = 'comicbase' AND g.observation_kind = 'guide_quote'
      ORDER BY g.snapshot_on DESC LIMIT 1
  ) cb ON TRUE
  LEFT JOIN LATERAL (
      SELECT g.guide_price, g.snapshot_on FROM vault_market.guide_price_observation g
      WHERE g.asset_id = h.asset_id
        AND g.source = 'pricecharting' AND g.condition_key = 'raw_ungraded'
        AND g.observation_kind = 'guide_quote'
      ORDER BY g.snapshot_on DESC LIMIT 1
  ) pc ON TRUE
  WHERE ${OWNED} AND h.needs_verification IS TRUE
`;

const COUNTS_SQL = sql`
  SELECT
      count(*)::int AS owned_total,
      count(*) FILTER (WHERE h.needs_verification IS TRUE)::int AS needs_verification,
      count(*) FILTER (WHERE h.needs_verification IS NOT TRUE)::int AS verified,
      count(*) FILTER (
        WHERE h.needs_verification IS FALSE
          AND (h.clz_metadata->>${VERIFICATION_MARKED_AT_KEY}) IS NOT NULL
          AND (h.clz_metadata->>${VERIFICATION_MARKED_AT_KEY})::timestamptz >= now() - interval '7 days'
      )::int AS verified_this_week
  FROM vault_collection.holding h
  WHERE ${OWNED}
`;

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isoDate(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function candidateFromRow(row: Record<string, unknown>): VerificationCandidate {
  const quotes: GuideQuote[] = [];
  const push = (source: GuideQuote["source"], price: unknown, on: unknown) => {
    const p = num(price);
    if (p != null) quotes.push({ source, price: p, observedOn: isoDate(on) });
  };
  push("covrprice", row.covrprice_price, row.covrprice_on);
  push("comicbase", row.comicbase_price, row.comicbase_on);
  push("pricecharting", row.pricecharting_price, row.pricecharting_on);
  // CLZ's own value has no quote date; it counts as a source but not toward recency.
  push("clz", row.current_price_snapshot ?? row.clz_meta_price, null);

  const clzKey = String(row.clz_key ?? "").trim();
  const isKey = Boolean(row.is_key_issue) || (clzKey !== "" && clzKey.toLowerCase() !== "no");
  const title = [
    String(row.series_title ?? "").trim(),
    row.issue_number ? `#${row.issue_number}` : "",
    row.cover_label ? String(row.cover_label) : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: String(row.source_row_id),
    title: title || String(row.source_row_id),
    publisher: row.publisher ? String(row.publisher) : null,
    isKeyIssue: isKey,
    keyReason: (row.key_reason ?? row.clz_key_reason ?? null) ? String(row.key_reason ?? row.clz_key_reason) : null,
    verificationNotes: row.verification_notes ? String(row.verification_notes) : null,
    importedAt: new Date(String(row.imported_at)),
    quotes,
  };
}

export async function loadVerificationQueue(
  query: { limit: number; offset: number },
  now: Date = new Date(),
): Promise<VerificationQueueResponse> {
  const base = {
    ruleOrModelVersion: VERIFICATION_QUEUE_RULE,
    ordering: VERIFICATION_ORDERING,
    note: "Guide ranges are vendor guides (unverified), not sold comps. Each book is cleared by one operator click; there is no bulk verify.",
    limit: query.limit,
    offset: query.offset,
  };
  try {
    const db = getDb();
    const [rows, counts] = await Promise.all([db.execute(CANDIDATES_SQL), db.execute(COUNTS_SQL)]);
    const ranked = rankVerificationQueue(
      (rows.rows as Record<string, unknown>[]).map(candidateFromRow),
      now,
    );
    const c = (counts.rows as Record<string, unknown>[])[0] ?? {};
    return VerificationQueueResponseSchema.parse({
      ...base,
      available: true,
      error: null,
      counts: {
        ownedTotal: Number(c.owned_total ?? 0),
        needsVerification: Number(c.needs_verification ?? 0),
        verified: Number(c.verified ?? 0),
        verifiedThisWeek: Number(c.verified_this_week ?? 0),
        needsVerificationWithGuide: ranked.filter((r) => r.guideRange).length,
      },
      items: ranked.slice(query.offset, query.offset + query.limit),
    });
  } catch (e) {
    return VerificationQueueResponseSchema.parse({
      ...base,
      available: false,
      error: e instanceof Error ? e.message : String(e),
      counts: { ownedTotal: 0, needsVerification: 0, verified: 0, verifiedThisWeek: 0, needsVerificationWithGuide: 0 },
      items: [],
    });
  }
}
