import { EBAY_SKU_MAX_LEN, SKU_RULE } from "./constants.js";
import type { CategoryKind } from "./schemas.js";

const TOKEN: Record<CategoryKind, string> = {
  comic: "COMIC",
  sports: "SPORTS",
  pokemon: "POKEMON",
  mtg: "MTG",
  other: "OTHER",
};

const SKU_RE = /^IQV-(COMIC|SPORTS|POKEMON|MTG|OTHER)-[A-Z0-9]+$/;

/**
 * Durable eBay SKU for a holding — never encodes mutable descriptive data.
 * Format: IQV-{CATEGORY}-{inventory_id compact}.
 */
export function categorySkuToken(kind: CategoryKind): string {
  return TOKEN[kind];
}

export function compactInventoryId(inventoryId: string): string {
  const compact = inventoryId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (compact.length < 8) {
    throw new Error(`inventory id is too short to mint a stable SKU (${SKU_RULE})`);
  }
  return compact;
}

export function buildEbaySku(kind: CategoryKind, inventoryId: string): string {
  const sku = `IQV-${categorySkuToken(kind)}-${compactInventoryId(inventoryId)}`;
  if (sku.length > EBAY_SKU_MAX_LEN) {
    throw new Error(`SKU exceeds eBay ${EBAY_SKU_MAX_LEN}-char limit: ${sku.length}`);
  }
  if (!SKU_RE.test(sku)) {
    throw new Error(`SKU failed durability check: ${sku}`);
  }
  return sku;
}

export function parseEbaySku(sku: string): { category: CategoryKind; compactId: string } | null {
  const m = sku.trim().toUpperCase().match(/^IQV-(COMIC|SPORTS|POKEMON|MTG|OTHER)-([A-Z0-9]+)$/);
  if (!m) return null;
  const token = m[1] as string;
  const category = (Object.keys(TOKEN) as CategoryKind[]).find((k) => TOKEN[k] === token);
  if (!category) return null;
  return { category, compactId: m[2] as string };
}

export function assertUniqueSkus(skus: string[]): void {
  const seen = new Set<string>();
  for (const sku of skus) {
    if (seen.has(sku)) {
      throw new Error(`Duplicate SKU ${sku} — one physical copy cannot share a durable identifier`);
    }
    seen.add(sku);
  }
}
