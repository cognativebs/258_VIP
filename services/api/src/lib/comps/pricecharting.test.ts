import { afterEach, describe, expect, it } from "vitest";
import { mapInventoryRow } from "../holdings.js";
import { pickComicProduct, pricechartingAdapter } from "./pricecharting.js";
import { buildComicBrowseQuery } from "./comicBrowseMatch.js";
import { ebaySoldAdapter } from "./ebaySold.js";

afterEach(() => {
  delete process.env.PRICECHARTING_API_TOKEN;
  delete process.env.VIP_PRICECHARTING_GAP_MS;
});

const comic = mapInventoryRow(
  {
    Series: "Action Comics, Vol. 1",
    "Issue Full": "900C",
    Publisher: "DC Comics",
    "CLZ Hash": "ac-900c",
    Quantity: 1,
  },
  0,
);

describe("pricechartingAdapter", () => {
  it("stays idle without a token and does not match", async () => {
    expect(pricechartingAdapter.matches(comic)).toBe(false);
    expect(ebaySoldAdapter.matches(comic)).toBe(true);
    const result = await pricechartingAdapter.fetchComps(comic);
    expect(result.sales).toEqual([]);
    expect(result.emptyReason).toMatch(/PRICECHARTING_API_TOKEN/);
  });

  it("replaces eBay Browse for comics when a token is set", () => {
    process.env.PRICECHARTING_API_TOKEN = "tok";
    expect(pricechartingAdapter.matches(comic)).toBe(true);
    expect(ebaySoldAdapter.matches(comic)).toBe(false);
  });

  it("picks the untitled #900 over cover variants when the letter is unmatched", () => {
    const query = buildComicBrowseQuery({ series: "Action Comics, Vol. 1", issue: "900" })!;
    const picked = pickComicProduct(
      [
        { id: "1", "console-name": "Comic Books Action Comics", "product-name": "Action Comics [Ross] #900 (2011)" },
        { id: "2", "console-name": "Comic Books Action Comics", "product-name": "Action Comics #900 (2011)" },
        { id: "3", "console-name": "Playstation", "product-name": "Action Comics #900" },
      ],
      query,
    );
    expect(picked?.id).toBe("2");
  });

  it("converts loose pennies to an unverified guide quote, never a sold", async () => {
    process.env.PRICECHARTING_API_TOKEN = "tok";
    process.env.VIP_PRICECHARTING_GAP_MS = "0";
    const prev = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/api/products")) {
        return new Response(
          JSON.stringify({
            status: "success",
            products: [
              {
                id: "2314159",
                "console-name": "Comic Books Action Comics",
                "product-name": "Action Comics #900 (2011)",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          status: "success",
          id: "2314159",
          "product-name": "Action Comics #900 (2011)",
          "loose-price": 1250,
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const result = await pricechartingAdapter.fetchComps(comic);
      expect(result.sales).toHaveLength(1);
      expect(result.sales[0]?.price).toBe(12.5);
      expect(result.sales[0]?.source).toBe("pricecharting.com/guide");
      expect(result.sales[0]?.provenance.verificationStatus).toBe("unverified");
      expect(result.sales[0]?.provenance.notes ?? "").toMatch(/not a sold ledger/);
    } finally {
      globalThis.fetch = prev;
    }
  });
});
