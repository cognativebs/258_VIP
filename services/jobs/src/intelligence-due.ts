import { z } from "zod";

/**
 * Read-only report of predictions waiting for a human to record the outcome
 * (vault_core.prediction_needs_scoring, migration 20260815_11). This job never
 * writes: resolution is a person's call on the IQVault intelligence page
 * (POST /api/intelligence/predictions/:id/resolve). Nothing auto-resolves.
 */
export const INTELLIGENCE_DUE_RULE = "intelligence-due-report@0.1.0";

export const IntelligenceDueReportSchema = z.object({
  rule: z.literal(INTELLIGENCE_DUE_RULE),
  source: z.literal("vault_core.prediction_needs_scoring"),
  asOf: z.string(),
  count: z.number().int().nonnegative(),
  oldestResolvesAt: z.string().nullable(),
  byModelVersion: z.record(z.string(), z.number().int().nonnegative()),
});
export type IntelligenceDueReport = z.infer<typeof IntelligenceDueReportSchema>;

export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export async function runIntelligenceDueReport(db: Queryable): Promise<IntelligenceDueReport> {
  const r = await db.query(
    `SELECT model_version, count(*)::int AS n, min(resolves_at) AS oldest, now() AS db_now
       FROM vault_core.prediction_needs_scoring
      GROUP BY model_version
      ORDER BY model_version`,
  );
  const rows = r.rows as Array<{ model_version: string; n: number; oldest: Date | string; db_now: Date | string }>;
  const asOf = rows[0]?.db_now ?? (await db.query(`SELECT now() AS db_now`)).rows[0]?.db_now ?? new Date();
  const oldest = rows
    .map((x) => new Date(x.oldest))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return IntelligenceDueReportSchema.parse({
    rule: INTELLIGENCE_DUE_RULE,
    source: "vault_core.prediction_needs_scoring",
    asOf: new Date(asOf).toISOString(),
    count: rows.reduce((s, x) => s + Number(x.n), 0),
    oldestResolvesAt: oldest ? oldest.toISOString() : null,
    byModelVersion: Object.fromEntries(rows.map((x) => [x.model_version, Number(x.n)])),
  });
}

export function formatIntelligenceDueReport(r: IntelligenceDueReport): string {
  if (r.count === 0) return `intelligence-due: no predictions waiting for an outcome (${r.asOf}).`;
  const models = Object.entries(r.byModelVersion)
    .map(([m, n]) => `${m} ${n}`)
    .join(", ");
  return `intelligence-due: ${r.count} prediction(s) past horizon with no outcome (oldest due ${r.oldestResolvesAt}; ${models}). Resolve on IQVault /intelligence — nothing auto-resolves.`;
}
