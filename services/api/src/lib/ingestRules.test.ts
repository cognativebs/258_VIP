import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyLifecycle,
  assertMethod,
  batchVisible,
  commitAllowed,
  deriveStages,
  legacyLifecycle,
  mapColumns,
  normalizeGtin,
  parseCsv,
  rollupQuantity,
  thinComps,
  upcIdentityViolation,
} from "./ingestRules.js";

describe("ingest rules", () => {
  it("normalizes a GTIN to 14 digits and rejects a bad check digit", () => {
    const ok = normalizeGtin("036000291452");
    expect(ok).toEqual({ ok: true, gtin14: "00036000291452" });
    const bad = normalizeGtin("036000291453");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/Check digit/);
    expect(normalizeGtin("12ab").ok).toBe(false);
  });

  it("rejects condition on a UPC body", () => {
    expect(upcIdentityViolation({ grade: "NM" })).toMatch(/cannot set grade/);
    expect(upcIdentityViolation({})).toBeNull();
  });

  it("keeps committed terminal and lets abandoned resume", () => {
    expect(applyLifecycle("committed", "resume").ok).toBe(false);
    expect(applyLifecycle("abandoned", "resume")).toEqual({ ok: true, to: "active" });
    expect(applyLifecycle("active", "abandon")).toEqual({ ok: true, to: "abandoned" });
    expect(applyLifecycle("active", "pause")).toEqual({ ok: true, to: "paused" });
  });

  it("hides fixture batches unless the environment allows them", () => {
    expect(batchVisible(true, false)).toBe(false);
    expect(batchVisible(true, true)).toBe(true);
    expect(batchVisible(false, false)).toBe(true);
  });

  it("derives the stage strip from counters", () => {
    const blocked = deriveStages({
      lifecycle: "active",
      captured: 4,
      identified: 2,
      review: 2,
      acceptingRows: true,
    });
    expect(blocked.capture).toBe("current");
    expect(blocked.commitEnabled).toBe(false);
    expect(blocked.partialAvailable).toBe(true);
    const clear = deriveStages({
      lifecycle: "active",
      captured: 2,
      identified: 2,
      review: 0,
      acceptingRows: false,
    });
    expect(clear.commitEnabled).toBe(true);
  });

  it("maps the live Ricoh statuses without deleting them", () => {
    expect(legacyLifecycle("review", "ed919c12-4634-439f-b7b6-28d98fa328f3")).toBe("abandoned");
    expect(legacyLifecycle("open", "other")).toBe("paused");
    expect(legacyLifecycle("closed", "other")).toBe("committed");
  });

  it("blocks dealer and investment commits that lack their required fields", () => {
    expect(
      commitAllowed({
        destination: "dealer_inventory",
        assetId: "a",
        costBasis: null,
        acquiredOn: null,
        quantity: 1,
        needsReview: false,
        subtargetKind: null,
        slotId: null,
      }).ok,
    ).toBe(false);
    expect(
      commitAllowed({
        destination: "investment_vault",
        assetId: "a",
        costBasis: 4,
        acquiredOn: null,
        quantity: 1,
        needsReview: false,
        subtargetKind: null,
        slotId: null,
      }).ok,
    ).toBe(false);
    expect(
      commitAllowed({
        destination: "personal_collection",
        assetId: "a",
        costBasis: null,
        acquiredOn: null,
        quantity: 1,
        needsReview: false,
        subtargetKind: "binder",
        slotId: null,
      }).ok,
    ).toBe(false);
  });

  it("flags a release inside 90 days and applies a CSV preset", () => {
    expect(thinComps("2026-09-01", new Date("2026-09-23T00:00:00Z"))).toBe(true);
    expect(thinComps(null)).toBe(false);
    const table = parseCsv('Series,Quantity,Barcode\n"Batman, Vol. 1",1,036000291452\n');
    expect(table[1]?.[0]).toBe("Batman, Vol. 1");
    const mapped = mapColumns(table[0] ?? [], { name: "Series", quantity: "Quantity", barcode: "Barcode" });
    expect(mapped.name).toBe(0);
    expect(mapped.barcode).toBe(2);
  });

  it("derives quantity from scan events and keeps a voided duplicate in the log", () => {
    const events = [
      { gtin14: "00036000291452", quantity: 1, voided: false },
      { gtin14: "00036000291452", quantity: 1, voided: false },
      { gtin14: "00036000291452", quantity: 1, voided: true },
    ];
    expect(events).toHaveLength(3);
    expect(rollupQuantity(events, "00036000291452")).toBe(2);
  });

  it("does not disable API import by pretending it ran", () => {
    const result = assertMethod("api_import");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("No sources connected");
  });

  it("has no delete of a batch, scan unit, or raw snapshot", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const store = readFileSync(join(here, "ingestStore.ts"), "utf8");
    const routes = readFileSync(join(here, "../routes/ingest.ts"), "utf8");
    const sql = [
      "20260923_01_ingest_flow.sql",
      "20260923_02_ingest_scan_events.sql",
    ]
      .map((name) => readFileSync(join(here, "../../../../infra/db/migrations", name), "utf8"))
      .join("\n");
    for (const source of [store, routes, sql]) {
      expect(source).not.toMatch(/DELETE\s+FROM\s+vault_media\.scan/i);
      expect(source).not.toMatch(/DELETE\s+FROM\s+vault_media\.ingest_row/i);
      expect(source).not.toMatch(/DELETE\s+FROM\s+vault_evidence\.raw_snapshots/i);
      expect(source).not.toMatch(/TRUNCATE/i);
    }
    expect(store).not.toMatch(/UPDATE vault_media\.ingest_row SET quantity/);
  });
});
