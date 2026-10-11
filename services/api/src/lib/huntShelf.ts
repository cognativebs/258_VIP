import {
  huntShelfSummary,
  matchHuntItemToShelf,
  type HuntItemShelf,
  type HuntShelfSummary,
  type ShelfCopy,
} from "@vip/core-model";
import type { DefinedHunt, DefinedHuntItem, Queryable } from "./huntStore.js";

/**
 * Comics on the shelf, for hunt completion. CLZ holdings plus ComicBase rows not already linked
 * to a holding (a matched ComicBase row is the same physical book, so it is not counted twice).
 */
export async function loadShelfCopies(db: Queryable): Promise<ShelfCopy[]> {
  const holdings = await db.query(
    `SELECT h.id::text AS ref, s.title AS series, i.issue_number AS issue, v.cover_label AS cover,
            COALESCE(h.quantity, 1) AS quantity
       FROM vault_collection.holding h
       JOIN vault_comic.variant v ON v.asset_id = h.asset_id
       JOIN vault_comic.issue i   ON i.id = v.issue_id
       JOIN vault_comic.series s  ON s.id = i.series_id
      WHERE h.sold_at IS NULL`,
  );
  const comicbase = await db.query(
    `SELECT id::text AS ref, series_title AS series, issue_number AS issue, variant_letter AS cover,
            COALESCE(quantity, 1) AS quantity
       FROM vault_collection.comicbase_item
      WHERE matched_holding_id IS NULL`,
  );
  const row = (source: ShelfCopy["source"]) => (r: Record<string, unknown>): ShelfCopy => ({
    source,
    ref: String(r.ref),
    series: String(r.series ?? ""),
    issue: String(r.issue ?? ""),
    cover: r.cover == null || r.cover === "" ? null : String(r.cover),
    quantity: Math.max(0, Number(r.quantity ?? 1)),
  });
  return [...holdings.rows.map(row("clz_holding")), ...comicbase.rows.map(row("comicbase_item"))];
}

export type ShelfHuntItem = DefinedHuntItem & { shelf: HuntItemShelf };
export type ShelfHunt = Omit<DefinedHunt, "sections"> & {
  sections: { id: string; name: string; items: ShelfHuntItem[] }[];
  shelf: HuntShelfSummary;
};

/** Comic hunts get per-item shelf matches and a summary; other hunts pass through unchanged. */
export function withShelf(hunts: ReadonlyArray<DefinedHunt>, copies: ReadonlyArray<ShelfCopy>): Array<DefinedHunt | ShelfHunt> {
  return hunts.map((hunt) => {
    if (hunt.category !== "comic") return hunt;
    const sections = hunt.sections.map((s) => ({
      ...s,
      items: s.items.map((item) => ({ ...item, shelf: matchHuntItemToShelf(item, copies) })),
    }));
    const items = sections.flatMap((s) => s.items);
    return { ...hunt, sections, shelf: huntShelfSummary(items, items.map((i) => i.shelf)) };
  });
}
