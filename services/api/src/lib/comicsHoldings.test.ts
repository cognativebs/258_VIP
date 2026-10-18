import { describe, expect, it } from "vitest";
import { loadComicsHoldings } from "./comicsHoldings.js";

/**
 * Integration against a live IQVault Postgres. Skips when the DB is unreachable
 * so CI Node job (no Postgres) stays green; the Python CI job already gates
 * the import, and the API unit suite injects a comics fixture. Before any
 * ComicBase import (CI) the collection is the 2,700 CLZ holdings; after one it
 * is the ComicBase inventory.
 */
describe("loadComicsHoldings (live Postgres)", () => {
  it("loads the real collection with an attributable snapshot", async () => {
    const result = await loadComicsHoldings();
    if (!result.available) {
      // eslint-disable-next-line no-console
      console.warn("skipping live comics test:", result.error);
      return;
    }

    expect(result.snapshot).toBeTruthy();
    expect(result.snapshot?.shortHash).toHaveLength(12);

    if (result.inventorySource === "comicbase") {
      // ComicBase is the inventory (ADR 0016): matched CLZ holdings plus holdings made from ComicBase items.
      expect(result.snapshot?.label).toMatch(/^ComicBase report/);
      expect(result.holdings.length).toBeGreaterThan(0);
      expect(
        result.holdings.every((h) =>
          ["clz_import", "comicbase_export"].includes(h.provenance.source),
        ),
      ).toBe(true);
      const created = result.holdings.filter((h) => h.provenance.source === "comicbase_export");
      expect(created.every((h) => h.provenance.verificationStatus === "unverified")).toBe(true);
      return;
    }

    expect(result.holdings.length).toBe(2700);
    expect(result.snapshot?.recordCount).toBe(2700);

    const first = result.holdings[0];
    expect(first?.provenance.source).toBe("clz_import");
    expect(first?.provenance.ruleOrModelVersion).toBe("clz-python-ingest@0.2.0");
    // Raw NM-assumed books must stay inferred · unverified.
    const assumed = result.holdings.filter((h) => h.assumedGrade === "NM");
    expect(assumed.length).toBeGreaterThan(1000);
    expect(assumed.every((h) => h.provenance.verificationStatus === "unverified")).toBe(
      true,
    );
  }, 30_000);
});
