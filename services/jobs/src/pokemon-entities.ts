/**
 * Extract Pokémon entities from source items not yet read at their current
 * content version by the current extractor. Catalogs come from IQVault: the
 * national Dex list (@vip/core-model), set names in vault_pokemon.set and
 * Binder slots, card names in Binder slots, and set names learned from earlier
 * quoted mentions. Unmatched mentions are stored without an identity.
 */
import { SPECIES_BY_DEX } from "@vip/core-model";
import {
  POKEMON_ENTITY_EXTRACTOR_VERSION,
  entityKey,
  extractPokemonEntities,
  quotedSetCandidates,
  type EntityKind,
  type PokemonCatalog,
} from "@vip/signals";

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** Items read for Pokémon entities: PokéBeach plus the outlets indexed for cross-source clusters. */
export const ENTITY_SOURCES = ["pokebeach_official", "comicsbeat_rss", "alpha_investments_youtube", "psa_news", "tag_news", "gdelt_doc_v2"];

export type EntityExtractionReport = {
  job: "pokemon-entities";
  version: typeof POKEMON_ENTITY_EXTRACTOR_VERSION;
  items: number;
  entities: number;
  byKind: Partial<Record<EntityKind, number>>;
  withIdentity: number;
  learnedSets: string[];
};

export async function loadPokemonCatalog(db: Queryable): Promise<PokemonCatalog> {
  const catalogSets = await db.query(`SELECT id, name FROM vault_pokemon.set WHERE name IS NOT NULL`);
  const binderSets = await db.query(`SELECT DISTINCT set_name FROM vault_tcg.binder_slot WHERE set_name IS NOT NULL AND set_name <> ''`);
  const binderCards = await db.query(`SELECT DISTINCT card_name FROM vault_tcg.binder_slot WHERE card_name IS NOT NULL AND card_name <> ''`);
  const learned = await db.query(
    `SELECT DISTINCT ON (normalized_key) mention FROM vault_signals.source_item_entity
      WHERE entity_kind = 'set' AND match_method = 'quoted_set_name' ORDER BY normalized_key, created_at`,
  );
  const byKey = new Map<string, { name: string; ref: string }>();
  for (const r of catalogSets.rows) byKey.set(entityKey(r.name), { name: r.name, ref: `vault_pokemon.set:${r.id}` });
  for (const r of binderSets.rows) {
    const key = entityKey(r.set_name);
    if (key && !byKey.has(key)) byKey.set(key, { name: r.set_name, ref: `binder_set:${key}` });
  }
  return {
    species: SPECIES_BY_DEX,
    sets: [...byKey.values()],
    learnedSets: learned.rows.map((r) => r.mention),
    knownCardKeys: new Set(binderCards.rows.map((r) => entityKey(r.card_name)).filter(Boolean)),
  };
}

export async function extractSourceItemEntities(
  db: Queryable,
  opts: { sourceKeys?: string[]; limit?: number } = {},
): Promise<EntityExtractionReport> {
  const pending = await db.query(
    `SELECT i.id, i.title, i.excerpt, i.content_hash
       FROM vault_signals.source_item i
      WHERE i.source_id = ANY($1::text[]) AND i.content_hash IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM vault_signals.source_item_extraction x
           WHERE x.source_item_id = i.id AND x.content_hash = i.content_hash AND x.extractor_version = $2)
      ORDER BY i.published_at NULLS LAST, i.id
      LIMIT $3`,
    [opts.sourceKeys ?? ENTITY_SOURCES, POKEMON_ENTITY_EXTRACTOR_VERSION, opts.limit ?? 500],
  );
  const catalog = await loadPokemonCatalog(db);
  // Learn quoted set names from this batch first, so a plain mention elsewhere in it still matches.
  const learnedNow = new Set<string>(catalog.learnedSets);
  for (const r of pending.rows) for (const n of quotedSetCandidates(`${r.title}\n${r.excerpt ?? ""}`)) learnedNow.add(n);
  const fullCatalog: PokemonCatalog = { ...catalog, learnedSets: [...learnedNow] };

  const report: EntityExtractionReport = {
    job: "pokemon-entities",
    version: POKEMON_ENTITY_EXTRACTOR_VERSION,
    items: 0,
    entities: 0,
    byKind: {},
    withIdentity: 0,
    learnedSets: [...learnedNow].filter((n) => !catalog.learnedSets?.includes(n)),
  };
  for (const r of pending.rows) {
    const entities = extractPokemonEntities(`${r.title}\n${r.excerpt ?? ""}`, fullCatalog);
    await db.query(
      `INSERT INTO vault_signals.source_item_extraction (source_item_id, content_hash, extractor_version, entity_count)
       VALUES ($1, $2, $3, $4)`,
      [r.id, r.content_hash, POKEMON_ENTITY_EXTRACTOR_VERSION, entities.length],
    );
    for (const e of entities) {
      await db.query(
        `INSERT INTO vault_signals.source_item_entity
           (source_item_id, content_hash, extractor_version, entity_kind, mention, normalized_key, entity_ref, match_method, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [r.id, r.content_hash, POKEMON_ENTITY_EXTRACTOR_VERSION, e.kind, e.mention, e.normalizedKey, e.entityRef, e.method, e.confidence],
      );
      report.entities += 1;
      report.byKind[e.kind] = (report.byKind[e.kind] ?? 0) + 1;
      if (e.entityRef) report.withIdentity += 1;
    }
    report.items += 1;
  }
  return report;
}

export function formatEntityReport(r: EntityExtractionReport): string {
  const kinds = Object.entries(r.byKind)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  return [
    `VIP Job — pokemon-entities (${r.version})`,
    `items read ${r.items} · entities ${r.entities} (${kinds || "none"}) · matched to IQVault ${r.withIdentity}`,
    r.learnedSets.length ? `new set names learned (no identity yet): ${r.learnedSets.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
