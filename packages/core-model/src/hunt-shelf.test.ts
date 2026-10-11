import { describe, expect, it } from "vitest";
import {
  coverLetterOf,
  huntShelfSummary,
  matchHuntItemToShelf,
  normalizeIssue,
  normalizeSeries,
  type ShelfCopy,
} from "./hunt-shelf.js";

const copy = (series: string, issue: string, cover: string | null, quantity = 1, ref = `${series}-${issue}-${cover}`): ShelfCopy => ({
  source: "clz_holding",
  ref,
  series,
  issue,
  cover,
  quantity,
});

describe("hunt shelf matching", () => {
  it("normalizes series, issue and cover the way shelves record them", () => {
    expect(normalizeSeries("Batman (2nd Series)")).toBe("batman");
    expect(normalizeSeries("The Amazing Spider-Man")).toBe("amazing spider man");
    expect(normalizeIssue("#007")).toBe("7");
    expect(coverLetterOf("Cover B")).toBe("B");
    expect(coverLetterOf("A")).toBe("A");
    expect(coverLetterOf("Free Comic Book Day 2014 Edition")).toBeNull();
    expect(coverLetterOf("")).toBeNull();
  });

  it("counts an exact copy, keeps a cover-unknown copy as possible, and skips another cover", () => {
    const item = { id: "i1", status: "target" as const, details: { series: "Absolute Batman", issue: "1", coverLetter: "A" } };
    const shelf = matchHuntItemToShelf(item, [
      copy("Absolute Batman", "1", "A", 2),
      copy("Absolute Batman", "1", null),
      copy("Absolute Batman", "1", "B"),
      copy("Absolute Batman", "2", "A"),
    ]);
    expect(shelf.copies).toBe(2);
    expect(shelf.possibleCopies).toBe(1);
    expect(shelf.matches.map((m) => m.kind)).toEqual(["exact", "possible"]);
    expect(shelf.provenance.verificationStatus).toBe("unverified");
  });

  it("never claims an exact match for a variant the shelf cannot tell apart, or an unknown issue", () => {
    const virgin = { id: "v", status: "target" as const, details: { series: "Absolute Batman", issue: "1", coverLetter: null } };
    expect(matchHuntItemToShelf(virgin, [copy("Absolute Batman", "1", "A")])).toMatchObject({ copies: 0, possibleCopies: 1 });
    const unknown = { id: "u", status: "target" as const, details: { series: "Absolute Batman", issue: "unknown", coverLetter: null } };
    expect(matchHuntItemToShelf(unknown, [copy("Absolute Batman", "unknown", null)]).matches).toEqual([]);
  });

  it("summarizes on-shelf items with PASS excluded", () => {
    const items = [
      { id: "a", status: "target" as const },
      { id: "b", status: "target" as const },
      { id: "c", status: "pass" as const },
      { id: "d", status: "owned" as const },
    ];
    const shelf = [
      { itemId: "a", copies: 1, possibleCopies: 0 },
      { itemId: "b", copies: 0, possibleCopies: 1 },
      { itemId: "c", copies: 1, possibleCopies: 0 },
    ].map((s) => ({ ...s, matches: [], provenance: matchHuntItemToShelf({ id: s.itemId, status: "target", details: {} }, []).provenance }));
    expect(huntShelfSummary(items, shelf)).toMatchObject({ onShelf: 1, possible: 1, total: 3, pct: 33.3, verification: "unverified" });
  });
});
