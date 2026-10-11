import { describe, expect, it } from "vitest";
import { loadShelfCopies, withShelf, type ShelfHunt } from "./huntShelf.js";
import type { DefinedHunt } from "./huntStore.js";

const db = {
  query: async (text: string) =>
    text.includes("comicbase_item")
      ? { rows: [{ ref: "cb-1", series: "Absolute Batman", issue: "2", cover: "A", quantity: 1 }] }
      : { rows: [{ ref: "h-1", series: "Absolute Batman", issue: "001", cover: "Cover A", quantity: 2 }] },
};

const hunt = (category: string): DefinedHunt => ({
  id: "hunt",
  slug: "absolute-batman",
  name: "Absolute Batman",
  status: "active",
  description: "",
  category,
  source: "vault_hunt",
  rules: {},
  sets: [],
  metrics: { owned: 0, wanted: 3, missing: 0, passed: 0, total: 3, completionPct: 0, byStatus: {} } as DefinedHunt["metrics"],
  sections: [
    {
      id: "core",
      name: "Core",
      items: ["1", "2", "3"].map((issue) => ({
        id: `ab-${issue}`,
        key: `ab-${issue}-a`,
        name: `#${issue}`,
        status: "target" as const,
        priority: "high" as const,
        buyUnder: 4,
        market: null,
        grade: null,
        imageUrl: null,
        notes: null,
        paid: null,
        ownedQuantity: 0,
        priceBands: [],
        target: null,
        details: { series: "Absolute Batman", issue, coverLetter: "A" },
      })),
    },
  ],
});

describe("hunt shelf completion", () => {
  it("reads CLZ holdings and unlinked ComicBase rows, then matches comic hunts without touching status", async () => {
    const copies = await loadShelfCopies(db);
    expect(copies.map((c) => c.source)).toEqual(["clz_holding", "comicbase_item"]);
    const out = withShelf([hunt("comic")], copies)[0] as unknown as ShelfHunt;
    expect(out.shelf).toMatchObject({ onShelf: 2, total: 3 });
    const items = out.sections[0]!.items;
    expect(items.map((i) => i.shelf.copies)).toEqual([2, 1, 0]);
    expect(items.every((i) => i.status === "target")).toBe(true);
  });

  it("leaves non-comic hunts unchanged", () => {
    const [out] = withShelf([hunt("pokemon")], []);
    expect("shelf" in out!).toBe(false);
  });
});
