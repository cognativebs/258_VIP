import { z } from "zod";

/**
 * Unified search is a contract in this pass. The stub resolver returns nothing.
 *
 * Dependency: holdings, binder slots, transactions, signals, and conversations
 * are four-plus stores with different identifiers. One query has to resolve to
 * one entity. That entity layer does not exist, so ranking cannot be implemented
 * without pretending two ids are the same thing.
 */
export const searchResultTypeSchema = z.enum([
  "command",
  "holding",
  "binder_slot",
  "transaction",
  "signal",
  "conversation",
]);
export type SearchResultType = z.infer<typeof searchResultTypeSchema>;

export const searchResultSchema = z
  .object({
    type: searchResultTypeSchema,
    id: z.string().min(1),
    title: z.string().min(1),
    /** Present only after the entity layer can join stores. */
    entityId: z.string().min(1).nullable(),
  })
  .strict();
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z
  .object({
    connected: z.boolean(),
    query: z.string(),
    results: z.array(searchResultSchema),
    notice: z.string().min(1),
  })
  .strict();
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export type SearchResolver = (query: string) => Promise<SearchResponse>;

/** Display groups. This sequence is the ranking contract, not navigation. */
export const SEARCH_GROUPS: { type: SearchResultType; label: string }[] = [
  { type: "command", label: "Commands" },
  { type: "holding", label: "Holdings" },
  { type: "binder_slot", label: "Binder slots" },
  { type: "transaction", label: "Transactions" },
  { type: "signal", label: "Signals" },
  { type: "conversation", label: "Conversations" },
];

export const SEARCH_RANKING_CONTRACT = `
Ranking contract
================

Types are not comparable. Do not score a holding, a signal, a transaction,
and a conversation on one relevance number. A signal's attention must never
lift it above a holding, and a news-derived figure must never enter a
valuation slot.

Display order is the group list, fixed, not computed:
1. Commands
2. Holdings
3. Binder slots
4. Transactions
5. Signals
6. Conversations

Within a group, rank identifier match, then title match, then recency.
Do not blend attention, price, or confidence across groups.

Commands are navigation the shell could run without an index. They are still
empty in this pass because the palette is wired only to the stub resolver.

Entity-layer dependency
-----------------------
Holdings, signals, transactions, and conversations use different identifiers.
Binder slots use another. Until an entity layer maps those ids onto one entity,
a query cannot resolve to one thing. The stub returns connected: false and an
empty result set. Shipping a blended index before that layer would invent joins.
`.trim();
