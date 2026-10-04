/**
 * Operator commands for vault_core.signals_news_source (HS-5: only an operator
 * enables a source). Enabling records the endpoint the operator confirmed and
 * the date; disabling never touches the endpoint or terms.
 */
import { z } from "zod";

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export const NewsSourceEnableSchema = z
  .object({
    sourceKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
    endpoint: z.string().url().refine((u) => u.startsWith("https://"), "endpoint must be https").optional(),
  })
  .strict();

export type NewsSourceStatus = {
  sourceKey: string;
  displayName: string;
  enabled: boolean;
  endpoint: string | null;
  blockedReason: string | null;
};

export async function listNewsSources(db: Queryable): Promise<NewsSourceStatus[]> {
  const { rows } = await db.query(
    `SELECT source_key, display_name, adapter_enabled AND is_active AS enabled, endpoint, blocked_reason
       FROM vault_core.signals_news_source ORDER BY source_key`,
  );
  return rows.map((r) => ({
    sourceKey: r.source_key,
    displayName: r.display_name,
    enabled: Boolean(r.enabled),
    endpoint: r.endpoint,
    blockedReason: r.blocked_reason,
  }));
}

/** Throws when the row is missing, or when it has no endpoint and none was given. */
export async function enableNewsSource(db: Queryable, input: z.input<typeof NewsSourceEnableSchema>): Promise<NewsSourceStatus> {
  const { sourceKey, endpoint } = NewsSourceEnableSchema.parse(input);
  const { rows } = await db.query(
    `UPDATE vault_core.signals_news_source
        SET endpoint = coalesce($2, endpoint),
            adapter_enabled = true,
            is_active = true,
            verify_before_first_run = false,
            blocked_reason = NULL,
            prov_notes = 'Enabled by operator ' || to_char(now(), 'YYYY-MM-DD') || ', who confirmed the endpoint and terms. authority_seed is a seed estimate · unverified.'
      WHERE source_key = $1 AND coalesce($2, endpoint) IS NOT NULL
      RETURNING source_key, display_name, endpoint`,
    [sourceKey, endpoint ?? null],
  );
  if (!rows[0]) {
    const exists = await db.query(`SELECT 1 FROM vault_core.signals_news_source WHERE source_key = $1`, [sourceKey]);
    throw new Error(
      exists.rows.length
        ? `${sourceKey} has no endpoint; pass --endpoint https://... with the feed URL you confirmed`
        : `no news source ${sourceKey}`,
    );
  }
  return { sourceKey: rows[0].source_key, displayName: rows[0].display_name, enabled: true, endpoint: rows[0].endpoint, blockedReason: null };
}

export async function disableNewsSource(db: Queryable, sourceKey: string): Promise<void> {
  const { rows } = await db.query(
    `UPDATE vault_core.signals_news_source
        SET adapter_enabled = false, is_active = false,
            prov_notes = 'Disabled by operator ' || to_char(now(), 'YYYY-MM-DD') || '.'
      WHERE source_key = $1 RETURNING source_key`,
    [sourceKey],
  );
  if (!rows[0]) throw new Error(`no news source ${sourceKey}`);
}
