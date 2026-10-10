/**
 * Per-page chase completion for Binder (vault_tcg, ADR 0007): on each binder page, how many of
 * the pockets that name a card are owned. Empty pockets (no card assigned) are not part of the
 * chase. Counts only — no prices, no inferred ownership.
 */
import { z } from "zod";

export const PAGE_CHASE_RULE = "binder-page-chase@0.1.0";

export const PageChaseSchema = z
  .object({
    binderId: z.string(),
    binderName: z.string(),
    pageIndex: z.number().int().nonnegative(),
    title: z.string(),
    cards: z.number().int().nonnegative(),
    owned: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    wishlisted: z.number().int().nonnegative(),
    completion: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type PageChase = z.infer<typeof PageChaseSchema>;

export type PageChaseRow = {
  binder_id: string;
  binder_name: string;
  page_index: number;
  title: string | null;
  cards: number | string;
  owned: number | string;
  wishlisted: number | string;
};

export function pageChaseFromRows(rows: ReadonlyArray<PageChaseRow>): PageChase[] {
  return rows
    .map((r) => {
      const cards = Number(r.cards);
      const owned = Number(r.owned);
      return PageChaseSchema.parse({
        binderId: r.binder_id,
        binderName: r.binder_name,
        pageIndex: Number(r.page_index),
        title: r.title?.trim() || `Page ${Number(r.page_index) + 1}`,
        cards,
        owned,
        missing: cards - owned,
        wishlisted: Number(r.wishlisted),
        completion: cards > 0 ? Math.round((owned / cards) * 1000) / 1000 : null,
      });
    })
    .sort((a, b) => a.binderName.localeCompare(b.binderName) || a.pageIndex - b.pageIndex);
}

export const PAGE_CHASE_SQL = `
  SELECT b.id AS binder_id, b.name AS binder_name, p.page_index, p.title,
         count(s.id) FILTER (WHERE s.external_id IS NOT NULL OR s.card_name IS NOT NULL) AS cards,
         count(s.id) FILTER (WHERE s.owned) AS owned,
         count(s.id) FILTER (WHERE s.on_wishlist AND NOT s.owned) AS wishlisted
    FROM vault_tcg.binder_page p
    JOIN vault_tcg.binder b ON b.id = p.binder_id
    LEFT JOIN vault_tcg.binder_slot s ON s.page_id = p.id
   GROUP BY b.id, b.name, p.id, p.page_index, p.title`;

export type Queryable = { query: (text: string) => Promise<{ rows: any[] }> };

export async function loadPageChase(db: Queryable): Promise<PageChase[]> {
  const { rows } = await db.query(PAGE_CHASE_SQL);
  return pageChaseFromRows(rows as PageChaseRow[]);
}
