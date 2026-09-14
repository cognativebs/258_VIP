import { describe, expect, it } from "vitest";
import { runEbayBrowseCompsJob } from "./ebay-browse-comps.js";

describe("ebay-browse-comps job", () => {
  it("refuses to pull eBay asks", async () => {
    await expect(runEbayBrowseCompsJob({ query: "Charizard Base Set 4/102" })).rejects.toThrow(
      /not a valuation source/,
    );
  });
});
