import { afterEach, describe, expect, it } from "vitest";
import {
  fetchPriceChartingProduct,
  priceChartingEnabled,
  resetPriceChartingRateLimitForTests,
} from "./client.js";

afterEach(() => {
  resetPriceChartingRateLimitForTests();
  delete process.env.PRICECHARTING_TOKEN;
  delete process.env.PRICECHARTING_ENABLED;
});

describe("priceChartingEnabled", () => {
  it("is idle unless enabled and token are both set", () => {
    expect(priceChartingEnabled({})).toBe(false);
    expect(priceChartingEnabled({ PRICECHARTING_ENABLED: "true" })).toBe(false);
    expect(priceChartingEnabled({ PRICECHARTING_TOKEN: "x".repeat(40) })).toBe(false);
    expect(
      priceChartingEnabled({ PRICECHARTING_ENABLED: "true", PRICECHARTING_TOKEN: "x".repeat(40) }),
    ).toBe(true);
  });
});

describe("fetchPriceChartingProduct", () => {
  it("returns idle without calling the network when token is missing", async () => {
    let called = false;
    const result = await fetchPriceChartingProduct(
      { q: "earthbound" },
      {
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
      },
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.emptyReason).toMatch(/TOKEN unset/i);
  });

  it("parses a vendor product and converts via schema", async () => {
    const result = await fetchPriceChartingProduct(
      { id: "6910" },
      {
        token: "c0b53bce27c1bdab90b1605249e600dc43dfd1d5",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              status: "success",
              id: "6910",
              "product-name": "EarthBound",
              "console-name": "Super Nintendo",
              "loose-price": 17244,
            }),
            { status: 200 },
          ),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.product.id).toBe("6910");
      expect(result.product["loose-price"]).toBe(17244);
    }
  });

  it("does not throw on HTTP 429", async () => {
    const result = await fetchPriceChartingProduct(
      { q: "earthbound" },
      {
        token: "c0b53bce27c1bdab90b1605249e600dc43dfd1d5",
        fetchImpl: async () => new Response("slow down", { status: 429 }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.emptyReason).toMatch(/429/);
  });
});
