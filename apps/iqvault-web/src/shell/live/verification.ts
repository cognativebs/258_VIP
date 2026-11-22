import { z } from "zod";
import { apiGet } from "@/lib/api";
import type { ValueRangeProps } from "../schemas";

/**
 * VAULT → Needs review burn-down, from GET /api/comics/verification-queue.
 * The queue is read-only; each book is cleared by one operator click through
 * the existing comics PATCH path. There is no bulk verify.
 */
export const VERIFICATION_PAGE = 50;

const guideRangeSchema = z.object({
  low: z.number(),
  high: z.number(),
  sourceCount: z.number(),
  sources: z.array(z.string()),
  recencyDays: z.number().nullable(),
});

export const verificationQueueResponseSchema = z.object({
  available: z.boolean(),
  error: z.string().nullable(),
  ordering: z.string(),
  note: z.string(),
  counts: z.object({
    ownedTotal: z.number(),
    needsVerification: z.number(),
    verified: z.number(),
    verifiedThisWeek: z.number(),
  }),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      publisher: z.string().nullable(),
      isKeyIssue: z.boolean(),
      keyReason: z.string().nullable(),
      verificationNotes: z.string().nullable(),
      guideRange: guideRangeSchema.nullable(),
      ageDays: z.number(),
      queuePosition: z.number(),
    }),
  ),
});

export type VerificationItemModel = {
  id: string;
  title: string;
  detail: string;
  isKeyIssue: boolean;
  notes: string | null;
  /** Vendor-guide range, unverified. null → no guide quote. */
  range: ValueRangeProps | null;
  guideSources: string;
  position: number;
};

export type VerificationModel = {
  error: string | null;
  note: string | null;
  ordering: string | null;
  counts: { ownedTotal: number; needsVerification: number; verified: number; verifiedThisWeek: number };
  items: VerificationItemModel[];
};

const EMPTY_COUNTS = { ownedTotal: 0, needsVerification: 0, verified: 0, verifiedThisWeek: 0 };

export function verificationModelFromResponse(raw: unknown): VerificationModel {
  const parsed = verificationQueueResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "The verification queue did not match its contract.", note: null, ordering: null, counts: EMPTY_COUNTS, items: [] };
  }
  const data = parsed.data;
  return {
    error: data.available ? null : data.error ?? "Comics Postgres unavailable",
    note: data.note,
    ordering: data.ordering,
    counts: {
      ownedTotal: data.counts.ownedTotal,
      needsVerification: data.counts.needsVerification,
      verified: data.counts.verified,
      verifiedThisWeek: data.counts.verifiedThisWeek,
    },
    items: data.items.map((item) => ({
      id: item.id,
      title: item.title,
      detail: [item.publisher, item.isKeyIssue ? `Key${item.keyReason ? ` · ${item.keyReason}` : ""}` : null, `${item.ageDays}d unverified`]
        .filter(Boolean)
        .join(" · "),
      isKeyIssue: item.isKeyIssue,
      notes: item.verificationNotes,
      range: item.guideRange
        ? {
            low: item.guideRange.low,
            high: item.guideRange.high,
            compCount: item.guideRange.sourceCount,
            recencyDays: item.guideRange.recencyDays,
            // Vendor guides are unverified evidence; never shown above low confidence.
            confidence: "low",
            evidenceLabel: "guides",
          }
        : null,
      guideSources: item.guideRange ? item.guideRange.sources.join(", ") : "",
      position: item.queuePosition,
    })),
  };
}

export async function loadVerificationQueue(limit = VERIFICATION_PAGE, offset = 0): Promise<VerificationModel> {
  try {
    return verificationModelFromResponse(
      await apiGet<unknown>(`/api/comics/verification-queue?limit=${limit}&offset=${offset}`, 30_000),
    );
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Verification queue request failed",
      note: null,
      ordering: null,
      counts: EMPTY_COUNTS,
      items: [],
    };
  }
}
