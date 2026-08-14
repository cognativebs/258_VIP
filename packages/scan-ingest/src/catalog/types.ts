import type { CatalogCard, ScanCategory } from "../schemas.js";

/**
 * Catalog lookup seam (AGENTS.md rule 5).
 *
 * The fixture catalog is a five-card stand-in. Real identification will come
 * from Postgres assets already confirmed, then pokemontcg.io / Scryfall / a
 * sports catalog. Swapping any of those must not change the pipeline.
 */

export type CatalogQuery = {
  /** OCR text and/or file name, already normalized by the caller. */
  text: string;
  category?: ScanCategory | null;
  /** Exact identifiers read from a barcode / QR when present. */
  externalIds?: Array<{ source: string; value: string }>;
  limit?: number;
};

export type CatalogAdapter = {
  id: string;
  label: string;
  /**
   * Return catalog rows worth scoring. Adapters may pre-filter, but scoring and
   * confidence stay in the pipeline so every adapter is judged the same way.
   */
  search: (query: CatalogQuery) => Promise<CatalogCard[]>;
};

/** Adapter that can answer without I/O — used for the offline fixture path. */
export type SyncCatalogAdapter = CatalogAdapter & {
  searchSync: (query: CatalogQuery) => CatalogCard[];
};
