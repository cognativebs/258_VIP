export type HuntItemStatus = "owned" | "wanted" | "missing";

export type HuntItem = {
  id: string;
  name: string;
  status: HuntItemStatus;
  priority: "critical" | "high" | "medium" | "low";
  buyUnder: number | null;
  market: number | null;
  grade: string | null;
  imageUrl: string | null;
  notes: string | null;
};

export type HuntSection = {
  id: string;
  name: string;
  items: HuntItem[];
};

export type HuntCategory =
  | "comic"
  | "pokemon"
  | "one_piece"
  | "gundam"
  | "lorcana";

export type Hunt = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "paused" | "completed" | "coming_soon";
  description: string;
  category: HuntCategory;
  sections: HuntSection[];
  /** Proposed, not adopted: the operator has not committed to this hunt yet. */
  suggestion?: boolean;
  suggestionNote?: string;
};

export function item(
  id: string,
  name: string,
  opts: Partial<HuntItem> & { status?: HuntItemStatus } = {},
): HuntItem {
  return {
    id,
    name,
    status: opts.status ?? "missing",
    priority: opts.priority ?? "medium",
    buyUnder: opts.buyUnder ?? null,
    market: opts.market ?? null,
    grade: opts.grade ?? null,
    imageUrl: opts.imageUrl ?? null,
    notes: opts.notes ?? null,
  };
}

// The Absolute Batman sample now lives in vault_hunt (data/hunts/absolute-batman.json); the
// Pokémon 30th sample was retired 2026-10-10. Hunts are served from the database only.

export function huntCompletion(hunt: Hunt) {
  const items = hunt.sections.flatMap((s) => s.items);
  const owned = items.filter((i) => i.status === "owned").length;
  const wanted = items.filter((i) => i.status === "wanted").length;
  const missing = items.filter((i) => i.status === "missing").length;
  const total = items.length || 1;
  return {
    owned,
    wanted,
    missing,
    total,
    completionPct: Math.round((owned / total) * 1000) / 10,
  };
}
