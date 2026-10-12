import { describe, expect, it } from "vitest";
import { doubleFeedSuspects } from "./doubleFeed.js";

const single = (key: string, width = 1488, height = 2080) => ({ key, width, height });

describe("double-feed suspects", () => {
  it("flags the stuck pair from batch ed919c12 and nothing else", () => {
    const sizes = [single("0041", 1491, 2081), single("0043", 1488, 2077), single("0045", 1562, 2214), single("0047", 1485, 2076), single("0049", 1487, 2087)];
    const got = doubleFeedSuspects(sizes);
    expect([...got.keys()]).toEqual(["0045"]);
    expect(got.get("0045")).toMatch(/possible double feed: 1562×2214 vs typical 1488×2081/);
  });

  it("needs a few scans to know the typical size, and ignores unknown sizes", () => {
    expect(doubleFeedSuspects([single("a"), single("b", 1600, 2300)]).size).toBe(0);
    expect(doubleFeedSuspects([single("a"), single("b"), single("c"), single("d"), { key: "e", width: null, height: null }]).size).toBe(0);
  });
});
