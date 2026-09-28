/**
 * vault_hunt persistence for hunts loaded from a definition file
 * (data/hunts/*.json). Loading is idempotent and never overwrites collector
 * state: status, paid, owned_quantity and set status belong to the collector.
 * A target price is replaced on reload only while it is still the operator's
 * definition value (a later sold-comps revision is kept).
 *
 * Market numbers are not stored here. Asks and sales are observations and are
 * read from vault_market when that slice lands.
 */
import {
  HUNT_OPEN_STATUSES,
  HuntDefinitionSchema,
  setProgress,
  type HuntDefinition,
  type HuntItemPatch,
  type HuntItemStatus,
  type HuntPriceBand,
  type HuntSetPatch,
} from "@vip/core-model";

export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export const HUNT_LOADER_VERSION = "hunt-definition-loader@0.1.0";

export type HuntLoadReport = {
  huntId: string;
  slug: string;
  huntCreated: boolean;
  itemsInserted: number;
  itemsUpdated: number;
  setsUpserted: number;
  setMembers: number;
  /** Items in this hunt's sections that the definition no longer lists. Never deleted. */
  notInDefinition: string[];
};

export async function loadHuntDefinition(
  db: Queryable,
  raw: unknown,
  opts: { file: string; now?: Date },
): Promise<HuntLoadReport> {
  const def: HuntDefinition = HuntDefinitionSchema.parse(raw);
  const loadedAt = (opts.now ?? new Date()).toISOString();
  const config = {
    definition: {
      file: opts.file,
      loader: HUNT_LOADER_VERSION,
      loadedAt,
      source: def.source,
    },
    philosophy: def.philosophy,
    rankingFactors: def.rankingFactors,
    dontChase: def.dontChase,
    marketRules: def.marketRules,
  };

  const hunt = await db.query(
    `INSERT INTO vault_hunt.collection_hunt (slug, name, category_id, status, description, priority, config)
     VALUES ($1, $2, (SELECT id FROM vault_core.categories WHERE kind = $3), 'active', $4, $5, $6::jsonb)
     ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           category_id = EXCLUDED.category_id,
           description = EXCLUDED.description,
           priority = EXCLUDED.priority,
           config = coalesce(vault_hunt.collection_hunt.config, '{}'::jsonb) || EXCLUDED.config,
           updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [def.slug, def.name, def.category, def.description, def.priority, JSON.stringify(config)],
  );
  const huntId: string = hunt.rows[0].id;

  const sectionIds = new Map<string, string>();
  for (const [i, section] of def.sections.entries()) {
    const r = await db.query(
      `INSERT INTO vault_hunt.hunt_section (hunt_id, slug, name, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (hunt_id, slug) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [huntId, section.slug, section.name, i],
    );
    sectionIds.set(section.slug, r.rows[0].id);
  }

  const itemIds = new Map<string, string>();
  let itemsInserted = 0;
  let itemsUpdated = 0;
  for (const [i, item] of def.items.entries()) {
    const metadata = {
      definition: {
        series: item.series,
        issue: item.issue,
        coverLetter: item.coverLetter,
        variantName: item.variantName,
        artist: item.artist,
        characterFocus: item.characterFocus,
        ratio: item.ratio,
        publisher: item.publisher,
        upc: item.upc,
        releaseDate: item.releaseDate,
        coverImage: item.coverImage,
        retailerExclusive: item.retailerExclusive,
        printLimitVerified: item.printLimitVerified,
        priceBands: item.priceBands,
        reason: item.reason,
        verification: def.source.verification,
      },
      target: { price: item.targetPrice, source: "operator_definition", setAt: loadedAt },
    };
    const r = await db.query(
      `INSERT INTO vault_hunt.hunt_item
         (section_id, item_key, name, status, priority, buy_under, metadata, sort_order)
       VALUES ($1, $2, $3, 'target', $4, $5, $6::jsonb, $7)
       ON CONFLICT (section_id, item_key) DO UPDATE
         SET name = EXCLUDED.name,
             priority = EXCLUDED.priority,
             sort_order = EXCLUDED.sort_order,
             buy_under = CASE
               WHEN coalesce(vault_hunt.hunt_item.metadata->'target'->>'source', 'operator_definition') = 'operator_definition'
               THEN EXCLUDED.buy_under ELSE vault_hunt.hunt_item.buy_under END,
             metadata = coalesce(vault_hunt.hunt_item.metadata, '{}'::jsonb)
               || jsonb_build_object('definition', EXCLUDED.metadata->'definition')
               || CASE
                    WHEN coalesce(vault_hunt.hunt_item.metadata->'target'->>'source', 'operator_definition') = 'operator_definition'
                    THEN jsonb_build_object('target', EXCLUDED.metadata->'target') ELSE '{}'::jsonb END,
             updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [sectionIds.get(item.section), item.key, item.name, item.priority, item.targetPrice, JSON.stringify(metadata), i],
    );
    itemIds.set(item.key, r.rows[0].id);
    if (r.rows[0].inserted) itemsInserted += 1;
    else itemsUpdated += 1;
  }

  let setMembers = 0;
  for (const set of def.sets) {
    const r = await db.query(
      `INSERT INTO vault_hunt.hunt_set (hunt_id, slug, name, description, priority)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (hunt_id, slug) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description,
             priority = EXCLUDED.priority, updated_at = now()
       RETURNING id`,
      [huntId, set.slug, set.name, set.description, set.priority],
    );
    const setId: string = r.rows[0].id;
    for (const [position, key] of set.members.entries()) {
      await db.query(
        `INSERT INTO vault_hunt.hunt_set_member (set_id, hunt_item_id, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (set_id, hunt_item_id) DO UPDATE SET position = EXCLUDED.position`,
        [setId, itemIds.get(key), position],
      );
      setMembers += 1;
    }
  }

  const orphans = await db.query(
    `SELECT i.name
       FROM vault_hunt.hunt_item i
       JOIN vault_hunt.hunt_section s ON s.id = i.section_id
      WHERE s.hunt_id = $1
        AND (i.item_key IS NULL OR NOT (i.item_key = ANY($2::text[])))
      ORDER BY i.name`,
    [huntId, def.items.map((i) => i.key)],
  );

  return {
    huntId,
    slug: def.slug,
    huntCreated: Boolean(hunt.rows[0].inserted),
    itemsInserted,
    itemsUpdated,
    setsUpserted: def.sets.length,
    setMembers,
    notInDefinition: orphans.rows.map((r) => r.name as string),
  };
}

export type DefinedHuntItem = {
  id: string;
  key: string | null;
  name: string;
  status: HuntItemStatus;
  priority: "critical" | "high" | "medium" | "low";
  buyUnder: number | null;
  /** Not stored. Filled from market observations in a later slice. */
  market: null;
  grade: string | null;
  imageUrl: string | null;
  notes: string | null;
  paid: number | null;
  ownedQuantity: number;
  priceBands: HuntPriceBand[];
  target: { price: number | null; source: string } | null;
  details: Record<string, unknown>;
};

export type DefinedHuntSet = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  members: { itemId: string; name: string; status: HuntItemStatus; paid: number | null; position: number }[];
  progress: ReturnType<typeof setProgress>;
};

export type DefinedHunt = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "paused" | "completed" | "coming_soon";
  description: string;
  category: string;
  source: "vault_hunt";
  rules: Record<string, unknown>;
  sections: { id: string; name: string; items: DefinedHuntItem[] }[];
  sets: DefinedHuntSet[];
  metrics: ReturnType<typeof huntMetrics>;
};

/** PASS is excluded from the total: an evaluated exclusion is not a gap. */
export function huntMetrics(items: ReadonlyArray<{ status: HuntItemStatus }>) {
  const counted = items.filter((i) => i.status !== "pass");
  const owned = counted.filter((i) => i.status === "owned").length;
  const wanted = counted.filter((i) => HUNT_OPEN_STATUSES.includes(i.status)).length;
  const missing = counted.filter((i) => i.status === "missing").length;
  const total = counted.length;
  const byStatus: Partial<Record<HuntItemStatus, number>> = {};
  for (const i of items) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
  return {
    owned,
    wanted,
    missing,
    passed: items.length - counted.length,
    total,
    completionPct: total === 0 ? 0 : Math.round((owned / total) * 1000) / 10,
    byStatus,
  };
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** Hunts that came from a definition file. Legacy seeded rows are served from TypeScript seeds. */
export async function listDefinedHunts(db: Queryable, idOrSlug?: string): Promise<DefinedHunt[]> {
  const hunts = await db.query(
    `SELECT h.id, h.slug, h.name, h.status, h.description, h.config, c.kind AS category
       FROM vault_hunt.collection_hunt h
       LEFT JOIN vault_core.categories c ON c.id = h.category_id
      WHERE h.config ? 'definition'
        AND ($1::text IS NULL OR h.id::text = $1 OR h.slug = $1)
      ORDER BY h.created_at`,
    [idOrSlug ?? null],
  );
  if (hunts.rows.length === 0) return [];
  const ids = hunts.rows.map((h) => h.id);

  const sections = await db.query(
    `SELECT id, hunt_id, name FROM vault_hunt.hunt_section
      WHERE hunt_id = ANY($1::uuid[]) ORDER BY sort_order, name`,
    [ids],
  );
  const items = await db.query(
    `SELECT i.id, i.section_id, i.item_key, i.name, i.status, i.priority, i.buy_under, i.grade,
            i.notes, i.paid, i.owned_quantity, i.metadata
       FROM vault_hunt.hunt_item i
       JOIN vault_hunt.hunt_section s ON s.id = i.section_id
      WHERE s.hunt_id = ANY($1::uuid[])
      ORDER BY i.sort_order, i.name`,
    [ids],
  );
  const sets = await db.query(
    `SELECT id, hunt_id, slug, name, description, status, priority
       FROM vault_hunt.hunt_set WHERE hunt_id = ANY($1::uuid[]) ORDER BY priority = 'critical' DESC, name`,
    [ids],
  );
  const members = await db.query(
    `SELECT m.set_id, m.hunt_item_id, m.position
       FROM vault_hunt.hunt_set_member m
       JOIN vault_hunt.hunt_set s ON s.id = m.set_id
      WHERE s.hunt_id = ANY($1::uuid[])
      ORDER BY m.position`,
    [ids],
  );

  const itemViews = new Map<string, DefinedHuntItem & { sectionId: string }>();
  for (const r of items.rows) {
    const meta = (r.metadata ?? {}) as { definition?: Record<string, unknown>; target?: { price: number | null; source: string } };
    const def = meta.definition ?? {};
    itemViews.set(r.id, {
      id: r.id,
      sectionId: r.section_id,
      key: r.item_key,
      name: r.name,
      status: r.status,
      priority: r.priority,
      buyUnder: num(r.buy_under),
      market: null,
      grade: r.grade,
      imageUrl: (def.coverImage as string | null) ?? null,
      notes: r.notes,
      paid: num(r.paid),
      ownedQuantity: Number(r.owned_quantity ?? 0),
      priceBands: (def.priceBands as HuntPriceBand[] | undefined) ?? [],
      target: meta.target ?? null,
      details: def,
    });
  }

  return hunts.rows.map((h) => {
    const huntItems = [...itemViews.values()].filter((i) =>
      sections.rows.some((s) => s.id === i.sectionId && s.hunt_id === h.id),
    );
    const { definition: _definition, ...rules } = (h.config ?? {}) as Record<string, unknown>;
    return {
      id: h.id,
      slug: h.slug,
      name: h.name,
      status: h.status,
      description: h.description ?? "",
      category: h.category ?? "other",
      source: "vault_hunt" as const,
      rules: { ...rules, definition: _definition },
      sections: sections.rows
        .filter((s) => s.hunt_id === h.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          items: huntItems
            .filter((i) => i.sectionId === s.id)
            .map(({ sectionId: _s, ...item }) => item),
        })),
      sets: sets.rows
        .filter((s) => s.hunt_id === h.id)
        .map((s) => {
          const setMembers = members.rows
            .filter((m) => m.set_id === s.id)
            .map((m) => {
              const item = itemViews.get(m.hunt_item_id)!;
              return { itemId: item.id, name: item.name, status: item.status, paid: item.paid, position: Number(m.position) };
            });
          return {
            id: s.id,
            slug: s.slug,
            name: s.name,
            description: s.description,
            status: s.status,
            priority: s.priority,
            members: setMembers,
            progress: setProgress(setMembers),
          };
        }),
      metrics: huntMetrics(huntItems),
    };
  });
}

/** Marking an item OWNED without a quantity records at least one copy. */
export async function updateHuntItem(
  db: Queryable,
  huntIdOrSlug: string,
  itemId: string,
  patch: HuntItemPatch,
): Promise<boolean> {
  const r = await db.query(
    `UPDATE vault_hunt.hunt_item i
        SET status = coalesce($3, i.status),
            paid = CASE WHEN $4::boolean THEN $5::numeric ELSE i.paid END,
            owned_quantity = CASE
              WHEN $6::int IS NOT NULL THEN $6::int
              WHEN $3 = 'owned' THEN greatest(i.owned_quantity, 1)
              ELSE i.owned_quantity END,
            updated_at = now()
       FROM vault_hunt.hunt_section s, vault_hunt.collection_hunt h
      WHERE i.id::text = $2 AND s.id = i.section_id AND h.id = s.hunt_id
        AND (h.id::text = $1 OR h.slug = $1)
      RETURNING i.id`,
    [
      huntIdOrSlug,
      itemId,
      patch.status ?? null,
      patch.paid !== undefined,
      patch.paid ?? null,
      patch.ownedQuantity ?? null,
    ],
  );
  return r.rows.length > 0;
}

export async function updateHuntSet(
  db: Queryable,
  huntIdOrSlug: string,
  setId: string,
  patch: HuntSetPatch,
): Promise<boolean> {
  const r = await db.query(
    `UPDATE vault_hunt.hunt_set st
        SET status = $3, updated_at = now()
       FROM vault_hunt.collection_hunt h
      WHERE st.id::text = $2 AND h.id = st.hunt_id AND (h.id::text = $1 OR h.slug = $1)
      RETURNING st.id`,
    [huntIdOrSlug, setId, patch.status],
  );
  return r.rows.length > 0;
}
