import { markInferred, ProvenanceSchema } from "@vip/evidence";
import { z } from "zod";
import type { HuntItemStatus } from "./hunts.js";

/**
 * Hunt completion against the shelf (comics). Computed at read time from the collection, never
 * stored, and never written back as an item status: a shelf match is inferred · unverified, and
 * OWNED stays the collector's call.
 */
export const HUNT_SHELF_RULE = "hunt-shelf@0.1.0";

export const ShelfCopySourceSchema = z.enum(["clz_holding", "comicbase_item"]);

export const ShelfCopySchema = z.object({
  source: ShelfCopySourceSchema,
  /** holding id or comicbase_item id. */
  ref: z.string().min(1),
  series: z.string(),
  issue: z.string(),
  /** Cover letter as recorded on the shelf, or null when the shelf does not say. */
  cover: z.string().nullable(),
  quantity: z.number().int().nonnegative(),
});
export type ShelfCopy = z.infer<typeof ShelfCopySchema>;

/** `exact`: series + issue + cover letter agree. `possible`: series + issue agree, cover unknown on one side. */
export const ShelfMatchKindSchema = z.enum(["exact", "possible"]);

export const HuntItemShelfSchema = z.object({
  itemId: z.string(),
  copies: z.number().int().nonnegative(),
  possibleCopies: z.number().int().nonnegative(),
  matches: z.array(
    z.object({
      source: ShelfCopySourceSchema,
      ref: z.string(),
      kind: ShelfMatchKindSchema,
      label: z.string(),
      quantity: z.number().int().nonnegative(),
    }),
  ),
  provenance: ProvenanceSchema,
});
export type HuntItemShelf = z.infer<typeof HuntItemShelfSchema>;

export const HuntShelfSummarySchema = z.object({
  /** Items with at least one exact shelf copy. */
  onShelf: z.number().int().nonnegative(),
  /** Items with only possible copies. */
  possible: z.number().int().nonnegative(),
  /** Items counted (PASS excluded, like hunt metrics). */
  total: z.number().int().nonnegative(),
  pct: z.number().min(0).max(100),
  ruleVersion: z.literal(HUNT_SHELF_RULE),
  verification: z.literal("unverified"),
});
export type HuntShelfSummary = z.infer<typeof HuntShelfSummarySchema>;

/** The definition fields the matcher reads (vip_hunt_definition_v1 items carry them). */
export type ShelfMatchableItem = {
  id: string;
  status: HuntItemStatus;
  details: { series?: unknown; issue?: unknown; coverLetter?: unknown };
};

export function normalizeSeries(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "Batman (2nd Series)" → "batman"
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the\s+/, "")
    .trim();
}

export function normalizeIssue(issue: string): string {
  const s = issue.trim().toLowerCase().replace(/^#/, "");
  return /^\d+$/.test(s) ? String(Number(s)) : s;
}

/** "A", "Cover A", "A Variant", "Variant B" → letter. Anything else (edition names, blank) → null. */
export function coverLetterOf(label: string | null | undefined): string | null {
  if (!label) return null;
  const m = /^(?:cover\s+|variant\s+)?([a-z])(?:\b|$)/i.exec(label.trim());
  return m ? m[1]!.toUpperCase() : null;
}

export function matchHuntItemToShelf(item: ShelfMatchableItem, copies: ReadonlyArray<ShelfCopy>): HuntItemShelf {
  const series = typeof item.details.series === "string" ? normalizeSeries(item.details.series) : "";
  const issue = typeof item.details.issue === "string" ? normalizeIssue(item.details.issue) : "";
  const wantCover = typeof item.details.coverLetter === "string" ? item.details.coverLetter.toUpperCase() : null;
  const matches: HuntItemShelf["matches"] = [];
  // An issue the hunt does not know ("unknown") cannot be matched.
  if (series && issue && issue !== "unknown") {
    for (const c of copies) {
      if (normalizeSeries(c.series) !== series || normalizeIssue(c.issue) !== issue) continue;
      const have = coverLetterOf(c.cover);
      if (wantCover && have && have !== wantCover) continue;
      matches.push({
        source: c.source,
        ref: c.ref,
        kind: wantCover && have === wantCover ? "exact" : "possible",
        label: `${c.series} #${c.issue}${c.cover ? ` · ${c.cover}` : ""}`,
        quantity: c.quantity,
      });
    }
  }
  const copiesExact = matches.filter((m) => m.kind === "exact").reduce((n, m) => n + m.quantity, 0);
  const copiesPossible = matches.filter((m) => m.kind === "possible").reduce((n, m) => n + m.quantity, 0);
  return {
    itemId: item.id,
    copies: copiesExact,
    possibleCopies: copiesPossible,
    matches,
    provenance: markInferred({
      source: "hunt_shelf_match",
      ruleOrModelVersion: HUNT_SHELF_RULE,
      confidence: copiesExact > 0 ? 0.8 : copiesPossible > 0 ? 0.4 : 0.6,
      confidenceBand: copiesExact > 0 ? "high" : copiesPossible > 0 ? "low" : "medium",
      notes: wantCover
        ? "Series + issue + cover letter against the shelf · unverified"
        : "Series + issue only: the shelf cannot tell this variant from other covers · unverified",
    }),
  };
}

export function huntShelfSummary(
  items: ReadonlyArray<Pick<ShelfMatchableItem, "id" | "status">>,
  shelf: ReadonlyArray<HuntItemShelf>,
): HuntShelfSummary {
  const byId = new Map(shelf.map((s) => [s.itemId, s]));
  const counted = items.filter((i) => i.status !== "pass");
  const onShelf = counted.filter((i) => (byId.get(i.id)?.copies ?? 0) > 0).length;
  const possible = counted.filter((i) => {
    const s = byId.get(i.id);
    return s && s.copies === 0 && s.possibleCopies > 0;
  }).length;
  const total = counted.length;
  return {
    onShelf,
    possible,
    total,
    pct: total === 0 ? 0 : Math.round((onShelf / total) * 1000) / 10,
    ruleVersion: HUNT_SHELF_RULE,
    verification: "unverified",
  };
}
