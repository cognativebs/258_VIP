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

const batmanCore: HuntItem[] = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  if (n === 1) {
    return item(`core-${n}`, `#${n} — Cover A (1st Print)`, {
      status: "owned",
      grade: "NM · unverified",
      buyUnder: 10,
      market: 12.5,
      priority: "high",
    });
  }
  if (n === 2) {
    return item(`core-${n}`, `#${n} — Cover A (1st Print)`, {
      status: "wanted",
      buyUnder: 5,
      market: 7.5,
      priority: "high",
    });
  }
  return item(`core-${n}`, `#${n} — Cover A (1st Print)`, {
    status: "missing",
    buyUnder: 4,
    market: 5,
    priority: n <= 5 ? "high" : "medium",
  });
});

export const absoluteBatmanHunt: Hunt = {
  id: "absolute-batman",
  slug: "absolute-batman",
  name: "Absolute Batman Master Hunt",
  status: "active",
  category: "comic",
  description:
    "Issues 1–20 Cover A first prints, plus variants / printings / exclusives with grading targets.",
  sections: [
    {
      id: "core-run",
      name: "Cover A First Prints (1–20)",
      items: batmanCore,
    },
    {
      id: "variants",
      name: "Key variants & exclusives",
      items: [
        item("var-1-virgin", "#1 Virgin", { status: "wanted", buyUnder: 40, market: 55, priority: "high" }),
        item("var-1-foil", "#1 Foil", { status: "missing", buyUnder: 25, market: 35 }),
        item("var-convention", "Convention exclusive", { status: "missing", priority: "low" }),
      ],
    },
  ],
};

export const pokemon30thHunt: Hunt = {
  id: "pokemon-30th",
  slug: "pokemon-30th",
  name: "Pokémon 30th Celebration",
  status: "active",
  category: "pokemon",
  description: "Master-set style sealed + singles goals from the Pokémon 30 intelligence run.",
  sections: [
    {
      id: "sealed",
      name: "Sealed priorities",
      items: [
        item("pkmn-etb", "30th ETB", { status: "wanted", buyUnder: 55, market: 70, priority: "high" }),
        item("pkmn-bb", "30th Booster Box", { status: "missing", buyUnder: 140, market: 165, priority: "critical" }),
        item("pkmn-collection", "Collection Box", { status: "wanted", buyUnder: 35, market: 45 }),
      ],
    },
    {
      id: "singles",
      name: "Singles goals",
      items: [
        item("pkmn-chase-1", "Chase SIR placeholder", { status: "missing", priority: "high" }),
        item("pkmn-chase-2", "Illustration rare placeholder", { status: "wanted", priority: "medium" }),
      ],
    },
  ],
};

export const HUNTS: Hunt[] = [absoluteBatmanHunt, pokemon30thHunt];

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
