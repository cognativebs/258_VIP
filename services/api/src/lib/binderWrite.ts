import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { binderPublicUrl, printedTcgName, resolveTcgCover } from "./tcgPresentation.js";

/**
 * Binder → VIP write path (ADR 0007 follow-on).
 *
 * Owned Binder slots become durable `vault_collection.holding` rows
 * (`source = 'binder_vault'`, keyed by slot id). Wishlisted slots become
 * `vault_collection.watchlist_item` rows. Clearing owned / wishlist deletes
 * the corresponding VIP row — Binder remains the layout editor; VIP keeps
 * the inventory / watch truth with provenance.
 */

export const BINDER_HOLDING_SOURCE = "binder_vault";
export const BINDER_WRITE_RULE = "binder-vip-write@0.1.0";

export type BinderSlotPayload = {
  slotId: string;
  binderId: string;
  binderName: string;
  pageTitle: string;
  pageIndex: number;
  roleLabel: string;
  source: string | null;
  externalId: string | null;
  cardName: string | null;
  setName: string | null;
  number: string | null;
  rarity: string | null;
  imageUrl: string | null;
  priceMarket: number | null;
  owned: boolean;
  onWishlist: boolean;
  provenanceSource: string | null;
  provenanceMethod: string | null;
  provenanceModelVersion: string | null;
  confidence: number | null;
  verificationStatus: string | null;
};

export type ProjectResult = {
  ok: true;
  slotId: string;
  holding: "upserted" | "deleted" | "skipped";
  watchlist: "upserted" | "deleted" | "skipped";
  assetId: string | null;
  holdingId: string | null;
  watchlistId: string | null;
};

function assetName(slot: BinderSlotPayload): string {
  const setName = slot.setName?.trim() || "Unknown set";
  const number = slot.number?.trim();
  const name = slot.cardName?.trim() || "Unnamed card";
  return [setName, number && `#${number}`, name].filter(Boolean).join(" ");
}

function slugFor(slot: BinderSlotPayload): string {
  const src = (slot.source || "upload").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const ext = (slot.externalId || slot.slotId).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return `tcg-${src}-${ext}`.slice(0, 200);
}

async function ensureAsset(slot: BinderSlotPayload): Promise<string> {
  const db = getDb();
  const extSource = slot.source?.trim() || null;
  const extValue = slot.externalId?.trim() || null;

  if (extSource && extValue) {
    const found = await db.execute(sql`
      SELECT asset_id FROM vault_core.external_id
       WHERE source = ${extSource} AND external_value = ${extValue}
       LIMIT 1
    `);
    const row = found.rows[0] as { asset_id: string } | undefined;
    if (row?.asset_id) return row.asset_id;
  }

  const slug = slugFor(slot);
  const bySlug = await db.execute(sql`
    SELECT id FROM vault_core.asset WHERE slug = ${slug} LIMIT 1
  `);
  const existing = bySlug.rows[0] as { id: string } | undefined;
  if (existing?.id) {
    if (extSource && extValue) {
      await db.execute(sql`
        INSERT INTO vault_core.external_id (asset_id, source, external_value)
        VALUES (${existing.id}::uuid, ${extSource}, ${extValue})
        ON CONFLICT (source, external_value) DO NOTHING
      `);
    }
    return existing.id;
  }

  const name = assetName(slot);
  const tags = [
    "binder",
    slot.owned ? "owned" : null,
    slot.onWishlist ? "wishlist" : null,
    slot.rarity ? `rarity:${slot.rarity}` : null,
  ].filter((t): t is string => Boolean(t));
  // node-pg + drizzle sql templates don't bind JS arrays as text[] reliably;
  // emit a literal Postgres array after sanitizing.
  const tagsLiteral = `{${tags.map((t) => `"${t.replace(/["\\]/g, "")}"`).join(",")}}`;

  const inserted = await db.execute(sql`
    INSERT INTO vault_core.asset
      (category_id, format, canonical_name, slug, primary_image_url, tags)
    VALUES (1, 'single', ${name}, ${slug}, ${slot.imageUrl}, ${tagsLiteral}::text[])
    RETURNING id
  `);
  const assetId = (inserted.rows[0] as { id: string }).id;

  if (extSource && extValue) {
    await db.execute(sql`
      INSERT INTO vault_core.external_id (asset_id, source, external_value)
      VALUES (${assetId}::uuid, ${extSource}, ${extValue})
      ON CONFLICT (source, external_value) DO NOTHING
    `);
  }
  return assetId;
}

async function upsertOwnedHolding(
  slot: BinderSlotPayload,
  assetId: string,
): Promise<string> {
  const db = getDb();
  const meta = JSON.stringify({
    binderId: slot.binderId,
    binderName: slot.binderName,
    pageTitle: slot.pageTitle,
    pageIndex: slot.pageIndex,
    roleLabel: slot.roleLabel,
    source: slot.source,
    externalId: slot.externalId,
    cardName: slot.cardName,
    setName: slot.setName,
    number: slot.number,
    rarity: slot.rarity,
    imageUrl: slot.imageUrl,
    writtenBy: BINDER_WRITE_RULE,
  });
  const notes = [
    `Binder: ${slot.binderName}`,
    slot.pageTitle ? `Page: ${slot.pageTitle}` : `Page ${slot.pageIndex + 1}`,
    slot.roleLabel ? `Role: ${slot.roleLabel}` : null,
    "Owned flag written from Binder Vault",
  ]
    .filter(Boolean)
    .join(" · ");

  const verified = (slot.verificationStatus ?? "").toLowerCase() === "verified";
  const result = await db.execute(sql`
    INSERT INTO vault_collection.holding
      (asset_id, quantity, location, collection_pillar, recommendation, sell_priority,
       needs_verification, verification_notes, current_price_snapshot,
       source, source_row_id, clz_metadata)
    VALUES (
      ${assetId}::uuid, 1, ${`Binder · ${slot.binderName}`},
      ${"TCG Owned (Binder)"}, ${"Hold"}, ${"Low"},
      ${!verified}, ${notes}, ${slot.priceMarket},
      ${BINDER_HOLDING_SOURCE}, ${slot.slotId}, ${meta}::jsonb
    )
    ON CONFLICT (source, source_row_id) DO UPDATE SET
      asset_id = EXCLUDED.asset_id,
      quantity = 1,
      location = EXCLUDED.location,
      collection_pillar = EXCLUDED.collection_pillar,
      recommendation = EXCLUDED.recommendation,
      sell_priority = EXCLUDED.sell_priority,
      needs_verification = EXCLUDED.needs_verification,
      verification_notes = EXCLUDED.verification_notes,
      current_price_snapshot = EXCLUDED.current_price_snapshot,
      clz_metadata = EXCLUDED.clz_metadata,
      updated_at = now()
    RETURNING id
  `);
  return (result.rows[0] as { id: string }).id;
}

async function deleteOwnedHolding(slotId: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute(sql`
    DELETE FROM vault_collection.holding
     WHERE source = ${BINDER_HOLDING_SOURCE} AND source_row_id = ${slotId}
  `);
  return (result.rowCount ?? 0) > 0;
}

async function upsertWishlist(
  slot: BinderSlotPayload,
  assetId: string,
): Promise<string> {
  const db = getDb();
  const note = [
    `Wishlist from Binder: ${slot.binderName}`,
    slot.pageTitle || `Page ${slot.pageIndex + 1}`,
    slot.roleLabel || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const result = await db.execute(sql`
    INSERT INTO vault_collection.watchlist_item
      (asset_id, binder_slot_id, source, source_row_id, asset_name, note,
       external_source, external_value,
       prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification)
    VALUES (
      ${assetId}::uuid, ${slot.slotId}, ${BINDER_HOLDING_SOURCE}, ${slot.slotId},
      ${assetName(slot)}, ${note},
      ${slot.source}, ${slot.externalId},
      ${slot.provenanceSource || "binder-vault"}, ${"observed"},
      ${BINDER_WRITE_RULE}, ${slot.confidence ?? 0.7},
      ${slot.verificationStatus || "unverified"}
    )
    ON CONFLICT (source, source_row_id) DO UPDATE SET
      asset_id = EXCLUDED.asset_id,
      asset_name = EXCLUDED.asset_name,
      note = EXCLUDED.note,
      external_source = EXCLUDED.external_source,
      external_value = EXCLUDED.external_value,
      prov_source = EXCLUDED.prov_source,
      prov_rule_version = EXCLUDED.prov_rule_version,
      prov_confidence = EXCLUDED.prov_confidence,
      prov_verification = EXCLUDED.prov_verification,
      updated_at = now()
    RETURNING id
  `);
  return (result.rows[0] as { id: string }).id;
}

async function deleteWishlist(slotId: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute(sql`
    DELETE FROM vault_collection.watchlist_item
     WHERE source = ${BINDER_HOLDING_SOURCE} AND source_row_id = ${slotId}
  `);
  return (result.rowCount ?? 0) > 0;
}

/** Load one filled Binder slot from vault_tcg. */
export async function loadBinderSlot(slotId: string): Promise<BinderSlotPayload | null> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      s.id AS slot_id,
      b.id AS binder_id,
      b.name AS binder_name,
      p.title AS page_title,
      p.page_index AS page_index,
      s.role_label AS role_label,
      s.source AS source,
      s.external_id AS external_id,
      s.card_name AS card_name,
      s.set_name AS set_name,
      s.number AS number,
      s.rarity AS rarity,
      s.image_url AS image_url,
      s.price_market AS price_market,
      s.owned AS owned,
      s.on_wishlist AS on_wishlist,
      s.provenance_source AS provenance_source,
      s.provenance_method AS provenance_method,
      s.provenance_model_version AS provenance_model_version,
      s.confidence AS confidence,
      s.verification_status AS verification_status
    FROM vault_tcg.binder_slot s
    JOIN vault_tcg.binder_page p ON p.id = s.page_id
    JOIN vault_tcg.binder b ON b.id = p.binder_id
    WHERE s.id = ${slotId}
      AND s.source IS NOT NULL AND s.source != ''
    LIMIT 1
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    slotId: String(row.slot_id),
    binderId: String(row.binder_id),
    binderName: String(row.binder_name),
    pageTitle: String(row.page_title ?? ""),
    pageIndex: Number(row.page_index) || 0,
    roleLabel: String(row.role_label ?? ""),
    source: row.source != null ? String(row.source) : null,
    externalId: row.external_id != null ? String(row.external_id) : null,
    cardName: row.card_name != null ? String(row.card_name) : null,
    setName: row.set_name != null ? String(row.set_name) : null,
    number: row.number != null ? String(row.number) : null,
    rarity: row.rarity != null ? String(row.rarity) : null,
    imageUrl: row.image_url != null ? String(row.image_url) : null,
    priceMarket:
      typeof row.price_market === "number" && Number.isFinite(row.price_market)
        ? row.price_market
        : row.price_market != null
          ? Number(row.price_market)
          : null,
    owned: Boolean(row.owned),
    onWishlist: Boolean(row.on_wishlist),
    provenanceSource: row.provenance_source != null ? String(row.provenance_source) : null,
    provenanceMethod: row.provenance_method != null ? String(row.provenance_method) : null,
    provenanceModelVersion:
      row.provenance_model_version != null ? String(row.provenance_model_version) : null,
    confidence:
      typeof row.confidence === "number" && Number.isFinite(row.confidence)
        ? row.confidence
        : null,
    verificationStatus:
      row.verification_status != null ? String(row.verification_status) : null,
  };
}

export async function projectSlotToVip(slotId: string): Promise<ProjectResult | { ok: false; error: string }> {
  try {
    const slot = await loadBinderSlot(slotId);
    if (!slot) {
      return { ok: false, error: "Filled Binder slot not found" };
    }

    // Empty card after clear — wipe any VIP rows for this slot.
    let holding: ProjectResult["holding"] = "skipped";
    let watchlist: ProjectResult["watchlist"] = "skipped";
    let assetId: string | null = null;
    let holdingId: string | null = null;
    let watchlistId: string | null = null;

    if (slot.owned || slot.onWishlist) {
      assetId = await ensureAsset(slot);
    }

    if (slot.owned) {
      holdingId = await upsertOwnedHolding(slot, assetId!);
      holding = "upserted";
    } else {
      const deleted = await deleteOwnedHolding(slot.slotId);
      holding = deleted ? "deleted" : "skipped";
    }

    if (slot.onWishlist) {
      watchlistId = await upsertWishlist(slot, assetId!);
      watchlist = "upserted";
    } else {
      const deleted = await deleteWishlist(slot.slotId);
      watchlist = deleted ? "deleted" : "skipped";
    }

    return {
      ok: true,
      slotId: slot.slotId,
      holding,
      watchlist,
      assetId,
      holdingId,
      watchlistId,
    };
  } catch (error) {
    // Node CI has no Postgres; callers (and the integration test) treat this
    // as a soft skip rather than a hard failure.
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function projectAllBinderSlots(opts?: {
  binderId?: string;
}): Promise<{
  ok: true;
  slots: number;
  holdingsUpserted: number;
  holdingsDeleted: number;
  watchlistUpserted: number;
  watchlistDeleted: number;
  errors: { slotId: string; error: string }[];
}> {
  const db = getDb();
  const result = opts?.binderId
    ? await db.execute(sql`
        SELECT s.id
          FROM vault_tcg.binder_slot s
          JOIN vault_tcg.binder_page p ON p.id = s.page_id
         WHERE p.binder_id = ${opts.binderId}
           AND s.source IS NOT NULL AND s.source != ''
      `)
    : await db.execute(sql`
        SELECT s.id
          FROM vault_tcg.binder_slot s
         WHERE s.source IS NOT NULL AND s.source != ''
      `);

  const ids = (result.rows as { id: string }[]).map((r) => r.id);
  let holdingsUpserted = 0;
  let holdingsDeleted = 0;
  let watchlistUpserted = 0;
  let watchlistDeleted = 0;
  const errors: { slotId: string; error: string }[] = [];

  for (const id of ids) {
    const projected = await projectSlotToVip(id);
    if (!projected.ok) {
      errors.push({ slotId: id, error: projected.error });
      continue;
    }
    if (projected.holding === "upserted") holdingsUpserted += 1;
    if (projected.holding === "deleted") holdingsDeleted += 1;
    if (projected.watchlist === "upserted") watchlistUpserted += 1;
    if (projected.watchlist === "deleted") watchlistDeleted += 1;
  }

  return {
    ok: true,
    slots: ids.length,
    holdingsUpserted,
    holdingsDeleted,
    watchlistUpserted,
    watchlistDeleted,
    errors,
  };
}

/** Durable binder_vault holdings as ApiHolding-shaped rows (for inventory merge). */
export async function loadDurableBinderHoldings(): Promise<
  {
    id: string;
    sourceRowId: string;
    assetName: string;
    series: string;
    issue: string;
    cardName: string | null;
    rarity: string | null;
    coverImageUrl: string | null;
    quantity: number;
    pillar: string | null;
    currentPrice: number | null;
    externalIds: { source: string; externalValue: string }[];
    needsVerification: boolean;
    verificationNotes: string | null;
    recommendationLabel: string | null;
    sellPriority: "High" | "Medium" | "Low" | null;
    meta: Record<string, unknown>;
  }[]
> {
  const db = getDb();
  try {
    const result = await db.execute(sql`
      SELECT
        h.id,
        h.source_row_id,
        h.quantity,
        h.collection_pillar,
        h.current_price_snapshot,
        h.needs_verification,
        h.verification_notes,
        h.recommendation,
        h.sell_priority,
        h.clz_metadata,
        a.canonical_name,
        a.primary_image_url,
        COALESCE(
          (
            SELECT json_agg(json_build_object('source', e.source, 'externalValue', e.external_value))
            FROM vault_core.external_id e
            WHERE e.asset_id = a.id
          ),
          '[]'::json
        ) AS external_ids
      FROM vault_collection.holding h
      JOIN vault_core.asset a ON a.id = h.asset_id
      WHERE h.source = ${BINDER_HOLDING_SOURCE}
      ORDER BY a.canonical_name
    `);

    return (result.rows as Record<string, unknown>[]).map((row) => {
      const rawMeta = row.clz_metadata;
      let meta: Record<string, unknown> = {};
      if (typeof rawMeta === "string") {
        try {
          meta = JSON.parse(rawMeta) as Record<string, unknown>;
        } catch {
          meta = {};
        }
      } else if (rawMeta && typeof rawMeta === "object") {
        meta = rawMeta as Record<string, unknown>;
      }
      const externalIds =
        (row.external_ids as { source: string; externalValue: string }[]) ?? [];
      const assetName = String(row.canonical_name);
      const series = String(meta.setName ?? meta.set_name ?? "");
      const issue = String(meta.number ?? "");
      return {
        id: String(row.id),
        sourceRowId: String(row.source_row_id),
        assetName,
        series,
        issue,
        cardName: printedTcgName({
          cardName: String(meta.cardName ?? meta.card_name ?? "").trim() || null,
          assetName,
          series,
          issue,
        }),
        rarity: String(meta.rarity ?? "").trim() || null,
        coverImageUrl: resolveTcgCover({
          coverImageUrl: String(meta.imageUrl ?? meta.image_url ?? "").trim() || null,
          primaryImageUrl: String(row.primary_image_url ?? "").trim() || null,
          binderPublicUrl: binderPublicUrl(),
          externalIds,
        }),
        quantity: Number(row.quantity) || 1,
        pillar: row.collection_pillar != null ? String(row.collection_pillar) : null,
        currentPrice:
          row.current_price_snapshot != null ? Number(row.current_price_snapshot) : null,
        externalIds,
        needsVerification: Boolean(row.needs_verification),
        verificationNotes:
          row.verification_notes != null ? String(row.verification_notes) : null,
        recommendationLabel: row.recommendation != null ? String(row.recommendation) : null,
        sellPriority: (["High", "Medium", "Low"] as const).includes(
          row.sell_priority as "High",
        )
          ? (row.sell_priority as "High" | "Medium" | "Low")
          : null,
        meta,
      };
    });
  } catch {
    return [];
  }
}

export async function loadDurableWatchlist(): Promise<
  {
    id: string;
    holdingId: string | null;
    assetName: string;
    note: string;
    addedAt: string;
    source: string;
    externalIds: { source: string; externalValue: string }[];
    provenance: {
      source: string;
      method: string;
      ruleOrModelVersion: string;
      confidence: number;
      verificationStatus: string;
    };
  }[]
> {
  const db = getDb();
  try {
    const result = await db.execute(sql`
      SELECT id, asset_id, asset_name, note, added_at, source,
             external_source, external_value, binder_slot_id,
             prov_source, prov_method, prov_rule_version,
             prov_confidence, prov_verification
        FROM vault_collection.watchlist_item
       ORDER BY added_at DESC
    `);
    return (result.rows as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      holdingId: row.binder_slot_id ? `binder-slot-${row.binder_slot_id}` : null,
      assetName: String(row.asset_name),
      note: String(row.note ?? "Watch"),
      addedAt: new Date(String(row.added_at)).toISOString().slice(0, 10),
      source: String(row.source),
      externalIds:
        row.external_source && row.external_value
          ? [
              {
                source: String(row.external_source),
                externalValue: String(row.external_value),
              },
            ]
          : [],
      provenance: {
        source: String(row.prov_source),
        method: String(row.prov_method),
        ruleOrModelVersion: String(row.prov_rule_version),
        confidence: Number(row.prov_confidence) || 0.7,
        verificationStatus: String(row.prov_verification),
      },
    }));
  } catch {
    return [];
  }
}
