import { sql } from "drizzle-orm";
import {
  createAssetCatalogAdapter,
  type CatalogAdapter,
  type CatalogCard,
  type CatalogQuery,
  type ScanCategory,
} from "@vip/scan-ingest";
import { getDb } from "../db/client.js";

const SCAN_KINDS = new Set<ScanCategory>(["pokemon", "sports", "mtg"]);

function asCategory(kind: unknown): ScanCategory | null {
  const value = String(kind ?? "");
  return SCAN_KINDS.has(value as ScanCategory) ? (value as ScanCategory) : null;
}

function searchPattern(text: string): string | null {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 2);
  if (tokens.length === 0) return null;
  return `%${tokens.join("%")}%`;
}

export async function searchConfirmedAssets(
  query: CatalogQuery,
): Promise<CatalogCard[]> {
  const limit = query.limit ?? 5;
  const hasExt = (query.externalIds?.length ?? 0) > 0;
  const pattern = searchPattern(query.text);
  if (!hasExt && !pattern) return [];

  const db = getDb();
  const extSource = hasExt ? query.externalIds![0]!.source : null;
  const extValue = hasExt ? query.externalIds![0]!.value : null;
  const category = query.category ?? null;

  const result = await db.execute(sql`
    SELECT
      a.id,
      a.canonical_name,
      a.release_year,
      cat.kind,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('source', e.source, 'value', e.external_value))
        FROM vault_core.external_id e
        WHERE e.asset_id = a.id
      ), '[]'::jsonb) AS external_ids
    FROM vault_core.asset a
    JOIN vault_core.categories cat ON cat.id = a.category_id
    WHERE a.is_active = true
      AND cat.kind IN ('pokemon', 'sports', 'mtg')
      AND (${category}::text IS NULL OR cat.kind = ${category})
      AND (
        (
          ${extSource}::text IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM vault_core.external_id e
            WHERE e.asset_id = a.id
              AND e.source = ${extSource}
              AND e.external_value = ${extValue}
          )
        )
        OR (
          ${pattern}::text IS NOT NULL
          AND a.canonical_name ILIKE ${pattern}
        )
      )
    ORDER BY a.canonical_name
    LIMIT ${limit}
  `);

  const rows = result.rows as Array<Record<string, unknown>>;
  const cards: CatalogCard[] = [];
  for (const row of rows) {
    const categoryKind = asCategory(row.kind);
    if (!categoryKind) continue;
    const name = String(row.canonical_name ?? "").trim();
    if (!name) continue;
    const extRaw = row.external_ids;
    const externalIds = Array.isArray(extRaw)
      ? (extRaw as Array<{ source?: string; value?: string }>)
          .filter((e) => e.source && e.value)
          .map((e) => ({ source: String(e.source), value: String(e.value) }))
      : [];
    const year = row.release_year != null ? Number(row.release_year) : null;
    cards.push({
      catalogKey: `asset:${row.id}`,
      category: categoryKind,
      displayName: name,
      setName: null,
      collectorNumber: null,
      playerOrCharacter: name,
      year: Number.isFinite(year) ? year : null,
      searchText: name,
      assetId: String(row.id),
      externalIds,
    });
  }
  return cards;
}

/**
 * Re-scans converge on already-confirmed `vault_core.asset` rows.
 * Failures return [] so a down database never fails a batch (ADR 0010 §3).
 */
export function createPostgresAssetCatalogAdapter(): CatalogAdapter {
  return createAssetCatalogAdapter({
    id: "postgres-assets",
    label: "Confirmed VIP assets",
    async search(query) {
      try {
        return await searchConfirmedAssets(query);
      } catch {
        return [];
      }
    },
  });
}
