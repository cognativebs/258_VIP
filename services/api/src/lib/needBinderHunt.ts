import { z } from "zod";
import type { ApiHolding } from "./holdings.js";
import type { Hunt, HuntItem, HuntSection } from "../seeds/hunts.js";

export const NEED_BINDER_HUNT_ID = "pokemon-need-binder";

export const NeedBinderHuntItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.literal("missing"),
  priority: z.enum(["critical", "high", "medium", "low"]),
  buyUnder: z.number().nullable(),
  market: z.number().nullable(),
  grade: z.string().nullable(),
  imageUrl: z.string().nullable(),
  notes: z.string().nullable(),
});
export type NeedBinderHuntItem = z.infer<typeof NeedBinderHuntItemSchema>;

export function isNeedBinderHolding(h: ApiHolding): boolean {
  return h.pillar === "TCG Need (Binder)";
}

export function isOwnedBinderHolding(h: ApiHolding): boolean {
  return h.pillar === "TCG Owned (Binder)";
}

export function binderNameFromNotes(notes: string | null | undefined): string {
  const match = notes?.match(/Binder:\s*([^·]+)/i);
  const name = match?.[1]?.trim();
  return name || "Need Binder";
}

export function needBinderPriority(price: number | null): HuntItem["priority"] {
  if (price == null) return "medium";
  if (price >= 100) return "critical";
  if (price >= 25) return "high";
  if (price >= 5) return "medium";
  return "low";
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "need-binder"
  );
}

export function holdingToNeedBinderItem(h: ApiHolding): NeedBinderHuntItem {
  const market = h.currentPrice;
  return NeedBinderHuntItemSchema.parse({
    id: h.id,
    name: (h.cardName?.trim() || h.assetName).trim() || "Unnamed card",
    status: "missing",
    priority: needBinderPriority(market),
    buyUnder: market,
    market,
    grade: h.assumedGrade,
    imageUrl: h.coverImageUrl,
    notes: h.verificationNotes,
  });
}

export function needBinderHuntMetrics(holdings: ApiHolding[]) {
  const owned = holdings.filter(isOwnedBinderHolding).length;
  const missing = holdings.filter(isNeedBinderHolding).length;
  const total = owned + missing || 1;
  return {
    owned,
    wanted: 0,
    missing,
    total,
    completionPct: Math.round((owned / total) * 1000) / 10,
  };
}

/** Live hunt from Binder need pockets. Not a seed list. */
export function buildNeedBinderHunt(holdings: ApiHolding[]): Hunt {
  const need = holdings.filter(isNeedBinderHolding);
  const byBinder = new Map<string, ApiHolding[]>();
  for (const holding of need) {
    const binder = binderNameFromNotes(holding.verificationNotes);
    const rows = byBinder.get(binder) ?? [];
    rows.push(holding);
    byBinder.set(binder, rows);
  }
  const sections: HuntSection[] = [...byBinder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rows]) => ({
      id: slug(name),
      name,
      items: rows
        .slice()
        .sort((a, b) =>
          (a.cardName ?? a.assetName).localeCompare(b.cardName ?? b.assetName),
        )
        .map((h) => holdingToNeedBinderItem(h) as HuntItem),
    }));

  return {
    id: NEED_BINDER_HUNT_ID,
    slug: NEED_BINDER_HUNT_ID,
    name: "Pokémon Need Binder",
    status: "active",
    category: "pokemon",
    description:
      "Still-needed Binder pockets. Buy / Hunt — these are not owned collection rows.",
    sections:
      sections.length > 0
        ? sections
        : [{ id: "need-binder", name: "Need Binder", items: [] }],
  };
}

export function needBinderHuntPayload(holdings: ApiHolding[]) {
  return {
    ...buildNeedBinderHunt(holdings),
    metrics: needBinderHuntMetrics(holdings),
  };
}
