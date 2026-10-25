import { describe, expect, it } from "vitest";
import { loadComicsHoldings } from "./comicsHoldings.js";

/**
 * Integration against a live IQVault Postgres. Skips when the DB is unreachable
 * so CI Node job (no Postgres) stays green; the Python CI job already gates
 * the import, and the API unit suite injects a comics fixture. The collection is
 * whatever CLZ export was imported last (2,700 in CI; the operator's own upload
 * locally), and empty until one is (2026-10-25 reset).
 */
describe("loadComicsHoldings (live Postgres)", () => {
  it("loads the real collection with an attributable snapshot", async () => {
    const result = await loadComicsHoldings();
    if (!result.available) {
      // eslint-disable-next-line no-console
      console.warn("skipping live comics test:", result.error);
      return;
    }
    if (!result.holdings.length) {
      // eslint-disable-next-line no-console
      console.warn("skipping live comics test: no CLZ export imported yet");
      return;
    }

    expect(result.snapshot).toBeTruthy();
    expect(result.holdings.length).toBe(result.snapshot?.recordCount);
    expect(result.snapshot?.shortHash).toHaveLength(12);

    const first = result.holdings[0];
    expect(first?.provenance.source).toBe("clz_import");
    expect(first?.provenance.ruleOrModelVersion).toBe("clz-python-ingest@0.2.0");
    // Raw NM-assumed books must stay inferred · unverified.
    const assumed = result.holdings.filter((h) => h.assumedGrade === "NM");
    expect(assumed.every((h) => h.provenance.verificationStatus === "unverified")).toBe(
      true,
    );
  }, 30_000);
});
