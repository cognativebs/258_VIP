import { describe, expect, it } from "vitest";
import { comicsValue } from "./comicsHoldings.js";

describe("comicsValue", () => {
  it("uses a locked value, then ComicBase's guide price, then CLZ's value", () => {
    expect(comicsValue(40, 95, false)).toEqual({ price: 95, source: "ComicBase" });
    expect(comicsValue(40, 95, true)).toEqual({ price: 40, source: "Locked value" });
    expect(comicsValue(40, null, false)).toEqual({ price: 40, source: "CLZ" });
    expect(comicsValue(0, null, false)).toEqual({ price: 0, source: "" });
    expect(comicsValue(0, 12.5, true)).toEqual({ price: 12.5, source: "ComicBase" });
  });
});
