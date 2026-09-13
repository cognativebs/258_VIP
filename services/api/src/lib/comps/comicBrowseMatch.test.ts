import { describe, expect, it } from "vitest";
import {
  COMIC_BROWSE_CATEGORY_IDS,
  COMIC_BROWSE_RULE,
  buildComicBrowseQuery,
  listingTitleMatchesComic,
  parseComicIssue,
  seriesSearchName,
} from "./comicBrowseMatch.js";

describe("buildComicBrowseQuery", () => {
  it("drops volume and publisher from the keyword string", () => {
    const q = buildComicBrowseQuery({
      series: "Action Comics, Vol. 1",
      issue: "900C",
    });
    expect(q).toEqual({
      q: "Action Comics #900",
      seriesTokens: ["action", "comics"],
      issue: { raw: "900C", number: "900", variant: "C" },
      categoryIds: COMIC_BROWSE_CATEGORY_IDS,
      ruleOrModelVersion: COMIC_BROWSE_RULE,
    });
  });

  it("parses cover letters and bare issue numbers", () => {
    expect(parseComicIssue("1A")).toEqual({ raw: "1A", number: "1", variant: "A" });
    expect(parseComicIssue("#2")).toEqual({ raw: "#2", number: "2", variant: null });
    expect(parseComicIssue("")).toBeNull();
  });

  it("strips a trailing volume from the series search name", () => {
    expect(seriesSearchName("Amazing Spider-Man, Vol. 1")).toBe("Amazing Spider-Man");
  });
});

describe("listingTitleMatchesComic", () => {
  const action = buildComicBrowseQuery({ series: "Action Comics, Vol. 1", issue: "900C" })!;
  const asm1 = buildComicBrowseQuery({ series: "The Amazing Spider-Man", issue: "1" })!;

  it("keeps the same book and drops lots, TPBs, and other issues", () => {
    expect(listingTitleMatchesComic("Action Comics #900 C Cover NM", action)).toBe(true);
    expect(listingTitleMatchesComic("Action Comics 900 (2011)", action)).toBe(true);
    expect(listingTitleMatchesComic("Superman Action Comics lot of 10", action)).toBe(false);
    expect(listingTitleMatchesComic("Action Comics #901", action)).toBe(false);
    expect(listingTitleMatchesComic("Action Comics Omnibus Vol 1", action)).toBe(false);
    expect(listingTitleMatchesComic("Detective Comics #900", action)).toBe(false);
  });

  it("does not treat vol 1 or 101 as Amazing Spider-Man #1", () => {
    expect(listingTitleMatchesComic("Amazing Spider-Man #1 (1963)", asm1)).toBe(true);
    expect(listingTitleMatchesComic("Amazing Spider-Man Vol 1 TPB", asm1)).toBe(false);
    expect(listingTitleMatchesComic("Amazing Spider-Man #101", asm1)).toBe(false);
  });
});
