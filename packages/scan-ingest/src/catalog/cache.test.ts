import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import { shouldPersistIdentification } from "./cache.js";
import type { CatalogResolverResult } from "./resolver-schemas.js";

function result(
  outcomes: CatalogResolverResult["outcomes"],
  candidates: CatalogResolverResult["candidates"] = [],
): CatalogResolverResult {
  return {
    candidates,
    outcomes,
    cacheHit: false,
    providerCalls: outcomes.filter((o) => o.called).length,
    contentHash: "h",
    category: "pokemon",
    provenance: markInferred({
      source: "catalog_resolver",
      ruleOrModelVersion: "t",
      confidence: 0,
    }),
  };
}

describe("shouldPersistIdentification", () => {
  it("persists a completed TCGdex pass with candidates", () => {
    expect(
      shouldPersistIdentification(
        result(
          [{ adapterId: "tcgdex", status: "ok", cardCount: 2, elapsedMs: 10, called: true }],
          [
            {
              catalogKey: "pokemon:tcgdex:sv1-1",
              category: "pokemon",
              displayName: "Sprigatito",
              externalIds: [{ source: "tcgdex", value: "sv1-1" }],
              confidence: 0.8,
              matchReasons: ["name:Sprigatito"],
              provenance: markInferred({
                source: "catalog_resolver",
                ruleOrModelVersion: "t",
                confidence: 0.8,
              }),
            },
          ],
        ),
      ),
    ).toBe(true);
  });

  it("does not persist an empty TCGdex miss without a name/number query", () => {
    expect(
      shouldPersistIdentification(
        result([{ adapterId: "tcgdex", status: "ok", cardCount: 0, elapsedMs: 10, called: true }]),
      ),
    ).toBe(false);
  });

  it("persists an empty miss when structured evidence produced a name", () => {
    expect(
      shouldPersistIdentification(
        result([{ adapterId: "tcgdex", status: "ok", cardCount: 0, elapsedMs: 10, called: true }]),
        { nameHint: "Linoone" },
      ),
    ).toBe(true);
  });

  it("does not persist a TCGdex timeout", () => {
    expect(
      shouldPersistIdentification(
        result([
          { adapterId: "tcgdex", status: "timeout", cardCount: 0, elapsedMs: 1500, called: true },
        ]),
      ),
    ).toBe(false);
  });

  it("does not persist fixture-only when TCGdex failed", () => {
    expect(
      shouldPersistIdentification(
        result([
          { adapterId: "tcgdex", status: "timeout", cardCount: 0, elapsedMs: 1500, called: true },
          { adapterId: "fixture-catalog", status: "ok", cardCount: 2, elapsedMs: 1, called: true },
        ]),
      ),
    ).toBe(false);
  });

  it("persists fixture-only when no real adapter ran (tests)", () => {
    expect(
      shouldPersistIdentification(
        result([
          { adapterId: "fixture-catalog", status: "ok", cardCount: 2, elapsedMs: 1, called: true },
        ]),
      ),
    ).toBe(true);
  });
});
