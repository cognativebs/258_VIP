import { describe, expect, it } from "vitest";
import { toPgTextArrayLiteral } from "./store.js";

describe("toPgTextArrayLiteral", () => {
  it("emits a Postgres text[] literal instead of a record cast", () => {
    const literal = toPgTextArrayLiteral([
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    ]);
    expect(literal.startsWith("{")).toBe(true);
    expect(literal).toContain("sell.inventory");
    expect(literal).not.toMatch(/^\(/);
  });
});
