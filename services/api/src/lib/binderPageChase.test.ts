import { describe, expect, it } from "vitest";
import { pageChaseFromRows } from "./binderPageChase.js";

describe("binder page chase", () => {
  it("counts owned vs missing per page, ignores empty pockets, and says 'no chase' instead of 0%", () => {
    const pages = pageChaseFromRows([
      { binder_id: "b2", binder_name: "Need Binder", page_index: 0, title: "", cards: 0, owned: 0, wishlisted: 0 },
      { binder_id: "b1", binder_name: "Base Set", page_index: 1, title: "Starters", cards: "9", owned: "6", wishlisted: "2" },
      { binder_id: "b1", binder_name: "Base Set", page_index: 0, title: "Holos", cards: 9, owned: 9, wishlisted: 0 },
    ]);
    expect(pages.map((p) => [p.binderName, p.title, p.owned, p.missing, p.wishlisted, p.completion])).toEqual([
      ["Base Set", "Holos", 9, 0, 0, 1],
      ["Base Set", "Starters", 6, 3, 2, 0.667],
      ["Need Binder", "Page 1", 0, 0, 0, null],
    ]);
  });
});
