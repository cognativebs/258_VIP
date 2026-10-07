/**
 * Ingest owned Pokémon sealed holdings into vault_core.asset + vault_market.sealed_product.
 * Source of truth: hunt CURRENT_HOLDINGS (actual owned SKUs), not the empty catalog table.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { fetchPriceChartingProduct } from "./client.js";

export const SEALED_INGEST_SOURCE = "sealed_ingest";
export const SEALED_INGEST_VERSION = "pricecharting-sealed-ingest@0.1.0";

export type OwnedSealedHolding = {
  sourceRowId: string;
  name: string;
  setName: string;
  productType: string;
  paid: number;
  market: number | null;
  msrp: number | null;
  releaseYear: number;
  retailer: string | null;
  queries: string[];
};

/** Hunt seed CURRENT_HOLDINGS — the only owned sealed SKUs in this repo. */
export const OWNED_SEALED_HOLDINGS: OwnedSealedHolding[] = [
  {
    sourceRowId: "hold-destined-rivals-bb",
    name: "Destined Rivals Booster Box",
    setName: "Destined Rivals",
    productType: "booster_box",
    paid: 144.99,
    market: 168,
    msrp: null,
    releaseYear: 2025,
    retailer: null,
    queries: ["Destined Rivals Booster Box", "Pokemon Destined Rivals Booster Box"],
  },
  {
    sourceRowId: "hold-chaos-rising-bb",
    name: "Chaos Rising Booster Box",
    setName: "Chaos Rising",
    productType: "booster_box",
    paid: 139.99,
    market: 155,
    msrp: null,
    releaseYear: 2025,
    retailer: null,
    queries: ["Chaos Rising Booster Box", "Pokemon Chaos Rising Booster Box"],
  },
  {
    sourceRowId: "hold-perfect-order-pc-etb",
    name: "Perfect Order Pokémon Center ETB",
    setName: "Perfect Order",
    productType: "etb",
    paid: 59.99,
    market: 95,
    msrp: 59.99,
    releaseYear: 2026,
    retailer: "Pokémon Center",
    queries: [
      "Perfect Order Pokemon Center Elite Trainer Box",
      "Perfect Order Pokemon Center ETB",
      "Perfect Order Elite Trainer Box",
    ],
  },
];

export function sealedProductType(productType: string, name: string): string {
  const blob = `${productType} ${name}`.toLowerCase();
  if (blob.includes("booster_box") || blob.includes("booster box")) return "booster_box";
  if (blob.includes("pc_etb") || blob.includes("elite trainer") || /\betb\b/.test(blob)) return "etb";
  if (blob.includes("tin")) return "tin";
  if (blob.includes("bundle")) return "bundle";
  if (blob.includes("collection")) return "collection_box";
  return productType || "sealed";
}

export function slugForSealed(name: string): string {
  return `pokemon-sealed-${name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

export type SealedIngestReport = {
  version: typeof SEALED_INGEST_VERSION;
  assetsUpserted: number;
  sealedRows: number;
  holdingsUpserted: number;
  upcFound: number;
  upcMissing: number;
  vendorHits: Array<{ sourceRowId: string; vendorProductId: string | null; upc: string | null }>;
};

async function pokemonCategoryId(): Promise<number> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT id FROM vault_core.categories WHERE kind = 'pokemon' LIMIT 1
  `);
  const row = result.rows[0] as { id: number } | undefined;
  if (!row) throw new Error("pokemon category missing");
  return Number(row.id);
}

export async function ingestOwnedSealed(): Promise<SealedIngestReport> {
  const db = getDb();
  const categoryId = await pokemonCategoryId();
  let assetsUpserted = 0;
  let sealedRows = 0;
  let holdingsUpserted = 0;
  let upcFound = 0;
  let upcMissing = 0;
  const vendorHits: SealedIngestReport["vendorHits"] = [];

  for (const item of OWNED_SEALED_HOLDINGS) {
    let upc: string | null = null;
    let vendorProductId: string | null = null;
    let vendorName: string | null = null;
    for (const q of item.queries) {
      const fetched = await fetchPriceChartingProduct({ q });
      if (!fetched.ok) continue;
      vendorProductId = fetched.product.id;
      vendorName = fetched.product["product-name"];
      upc = fetched.product.upc?.trim() || null;
      break;
    }
    if (upc) upcFound += 1;
    else upcMissing += 1;
    vendorHits.push({ sourceRowId: item.sourceRowId, vendorProductId, upc });

    const slug = slugForSealed(item.name);
    const tagsLiteral = '{"sealed","hunt-owned"}';
    const existing = await db.execute(sql`
      SELECT id FROM vault_core.asset WHERE slug = ${slug} LIMIT 1
    `);
    let assetId = (existing.rows[0] as { id: string } | undefined)?.id;
    if (!assetId) {
      const inserted = await db.execute(sql`
        INSERT INTO vault_core.asset
          (category_id, format, canonical_name, slug, release_year, tags)
        VALUES (
          ${categoryId}, 'sealed_product', ${item.name}, ${slug}, ${item.releaseYear},
          ${tagsLiteral}::text[]
        )
        ON CONFLICT (slug) DO UPDATE SET canonical_name = EXCLUDED.canonical_name
        RETURNING id
      `);
      assetId = (inserted.rows[0] as { id: string }).id;
      assetsUpserted += 1;
    }

    const productType = sealedProductType(item.productType, item.name);
    const sealed = await db.execute(sql`
      INSERT INTO vault_market.sealed_product
        (asset_id, category_id, product_name, set_name, product_type, language, msrp, upc)
      VALUES (
        ${assetId}::uuid, ${categoryId}, ${item.name}, ${item.setName}, ${productType},
        'english', ${item.msrp}, ${upc}
      )
      ON CONFLICT (asset_id) DO UPDATE SET
        product_name = EXCLUDED.product_name,
        set_name = EXCLUDED.set_name,
        product_type = EXCLUDED.product_type,
        msrp = EXCLUDED.msrp,
        upc = COALESCE(EXCLUDED.upc, vault_market.sealed_product.upc)
      RETURNING asset_id
    `);
    if (sealed.rowCount) sealedRows += 1;

    if (upc) {
      await db.execute(sql`
        INSERT INTO vault_core.external_id (asset_id, source, external_value)
        VALUES (${assetId}::uuid, 'upc', ${upc})
        ON CONFLICT (source, external_value) DO NOTHING
      `);
    }
    if (vendorProductId) {
      await db.execute(sql`
        INSERT INTO vault_core.external_id (asset_id, source, external_value, url)
        VALUES (
          ${assetId}::uuid, 'pricecharting', ${vendorProductId},
          ${vendorName ? `https://www.pricecharting.com/game/pokemon/${vendorProductId}` : null}
        )
        ON CONFLICT (source, external_value) DO NOTHING
      `);
    }

    const meta = JSON.stringify({
      huntId: "pokemon30th",
      sourceRowId: item.sourceRowId,
      setName: item.setName,
      productName: item.name,
      productType,
      retailer: item.retailer,
      writtenBy: SEALED_INGEST_VERSION,
    });
    const holding = await db.execute(sql`
      INSERT INTO vault_collection.holding
        (asset_id, quantity, purchase_price, location, collection_pillar, recommendation,
         sell_priority, needs_verification, verification_notes, current_price_snapshot,
         source, source_row_id, clz_metadata)
      VALUES (
        ${assetId}::uuid, 1, ${item.paid}, ${item.retailer ?? "hunt-owned"},
        ${"TCG Sealed (Hunt)"}, ${"Hold"}, ${"Low"}, false,
        ${`Owned sealed from Pokémon 30th hunt · ${item.name} · paid unverified vs market`},
        ${item.market}, ${SEALED_INGEST_SOURCE}, ${item.sourceRowId}, ${meta}::jsonb
      )
      ON CONFLICT (source, source_row_id) DO UPDATE SET
        asset_id = EXCLUDED.asset_id,
        purchase_price = EXCLUDED.purchase_price,
        current_price_snapshot = EXCLUDED.current_price_snapshot,
        clz_metadata = EXCLUDED.clz_metadata,
        updated_at = now()
      RETURNING id
    `);
    if (holding.rowCount) holdingsUpserted += 1;
  }

  return {
    version: SEALED_INGEST_VERSION,
    assetsUpserted,
    sealedRows,
    holdingsUpserted,
    upcFound,
    upcMissing,
    vendorHits,
  };
}

export function formatSealedIngestReport(report: SealedIngestReport): string {
  const hits = report.vendorHits
    .map((h) => `${h.sourceRowId} vendor=${h.vendorProductId ?? "none"} upc=${h.upc ?? "none"}`)
    .join("\n  ");
  return [
    `${report.version}`,
    `assetsUpserted=${report.assetsUpserted} sealedRows=${report.sealedRows} holdings=${report.holdingsUpserted}`,
    `upc found=${report.upcFound} missing=${report.upcMissing}`,
    `vendorHits:\n  ${hits}`,
  ].join("\n");
}
