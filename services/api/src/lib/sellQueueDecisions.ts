import { z } from "zod";
import type { Queryable } from "./huntStore.js";
import { SellQueueActionSchema } from "./sellQueue.js";

/**
 * Operator accept / reject marks on sell-queue advice (finish plan Q16, owner
 * 2026-11-23: "new log"). Append-only rows in vault_collection.sell_queue_decision.
 * A mark records what the operator decided about one piece of advice as it was
 * shown; it changes no holding, disposition or listing. The newest row per
 * holding is the current mark.
 */
export const SELL_QUEUE_DECISION_RULE = "sell-queue-decision-log@0.1.0";

export const SellQueueDecisionKindSchema = z.enum(["accepted", "rejected"]);

export const RecordSellQueueDecisionSchema = z
  .object({
    holdingId: z.string().trim().min(1).max(200),
    decision: SellQueueDecisionKindSchema,
    /** The advice as shown, so the log keeps what was decided on. */
    action: SellQueueActionSchema,
    confidence: z.number().min(0).max(1),
    ruleOrModelVersion: z.string().trim().min(1).max(300),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type RecordSellQueueDecision = z.infer<typeof RecordSellQueueDecisionSchema>;

export const SellQueueDecisionSchema = z
  .object({
    id: z.string().uuid(),
    holdingId: z.string(),
    holdingUuid: z.string().uuid().nullable(),
    decision: SellQueueDecisionKindSchema,
    action: SellQueueActionSchema,
    confidence: z.number().min(0).max(1),
    ruleOrModelVersion: z.string(),
    reason: z.string().nullable(),
    decidedBy: z.string(),
    decidedAt: z.string(),
  })
  .strict();
export type SellQueueDecision = z.infer<typeof SellQueueDecisionSchema>;

function fromRow(r: Record<string, unknown>): SellQueueDecision {
  return SellQueueDecisionSchema.parse({
    id: String(r.id),
    holdingId: String(r.holding_ref),
    holdingUuid: r.holding_id == null ? null : String(r.holding_id),
    decision: r.decision,
    action: r.recommended_action,
    confidence: Number(r.recommended_confidence),
    ruleOrModelVersion: String(r.advice_rule_version),
    reason: (r.reason as string | null) ?? null,
    decidedBy: String(r.decided_by),
    decidedAt: new Date(String(r.decided_at)).toISOString(),
  });
}

export async function recordSellQueueDecision(db: Queryable, body: unknown): Promise<SellQueueDecision> {
  const input = RecordSellQueueDecisionSchema.parse(body);
  const res = await db.query(
    `INSERT INTO vault_collection.sell_queue_decision
       (holding_ref, holding_id, decision, recommended_action, recommended_confidence,
        advice_rule_version, reason)
     VALUES (
       $1,
       (SELECT h.id FROM vault_collection.holding h
         WHERE h.id::text = $1 OR (h.source = 'clz_import' AND h.source_row_id = $1)
         ORDER BY (h.id::text = $1) DESC
         LIMIT 1),
       $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.holdingId,
      input.decision,
      input.action,
      Number(input.confidence.toFixed(3)),
      input.ruleOrModelVersion,
      input.reason ? input.reason : null,
    ],
  );
  return fromRow(res.rows[0] as Record<string, unknown>);
}

/** Newest mark per holding ref (all holdings when `refs` is omitted). */
export async function latestSellQueueDecisions(
  db: Queryable,
  refs?: string[],
): Promise<Map<string, SellQueueDecision>> {
  const res = await db.query(
    `SELECT DISTINCT ON (holding_ref) *
       FROM vault_collection.sell_queue_decision
      WHERE ($1::text[] IS NULL OR holding_ref = ANY($1::text[]))
      ORDER BY holding_ref, decided_at DESC, id DESC`,
    [refs ?? null],
  );
  return new Map(
    (res.rows as Array<Record<string, unknown>>).map((r) => {
      const d = fromRow(r);
      return [d.holdingId, d] as const;
    }),
  );
}

/** Full history for one holding, newest first. */
export async function sellQueueDecisionHistory(db: Queryable, holdingRef: string): Promise<SellQueueDecision[]> {
  const res = await db.query(
    `SELECT * FROM vault_collection.sell_queue_decision
      WHERE holding_ref = $1 ORDER BY decided_at DESC, id DESC LIMIT 200`,
    [holdingRef],
  );
  return (res.rows as Array<Record<string, unknown>>).map(fromRow);
}
