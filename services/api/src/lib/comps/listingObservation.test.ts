import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CONDITION_KEY_ANY } from "@vip/core-model";
import {
  FORBIDDEN_PERSIST_SQL,
  assertSafePersistSql,
  memoryListingObservationStore,
  observationsFromAdapterResult,
} from "./listingObservation.js";
import type { CompsAdapterResult } from "./types.js";

const listingAdapter = (): CompsAdapterResult => ({
  adapterId: "ebay-sold",
  rawJson: JSON.stringify({ itemSummaries: [{ itemId: "v1|1|0", price: { value: "3.59" } }] }),
  sales: [
    {
      id: "ebay:v1|1|0",
      listingId: "v1|1|0",
      price: 3.59,
      saleDate: new Date("2026-08-01T00:00:00.000Z"),
      source: "ebay.com/sold",
      title: "Justice #1C",
      provenance: {
        method: "api",
        ruleOrModelVersion: "ebay-sold@0.1.0",
        verificationStatus: "unverified",
        confidence: 0.55,
      },
    },
  ],
});

describe("listingObservation", () => {
  it("maps Browse sales to unverified listing rows with condition any", () => {
    const rows = observationsFromAdapterResult({
      assetId: randomUUID(),
      holdingId: randomUUID(),
      holdingSourceRowId: "justice-1c",
      adapter: listingAdapter(),
      observedAt: new Date("2026-08-28T00:00:00.000Z"),
      rawSnapshotId: randomUUID(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.observationKind).toBe("browse_listing");
    expect(rows[0]?.conditionKey).toBe(CONDITION_KEY_ANY);
    expect(rows[0]?.source).toBe("ebay_browse");
    expect(rows[0]?.askPrice).toBe(3.59);
    expect(rows[0]?.provenance.verificationStatus).toBe("unverified");
    expect(rows[0]?.providerIds.ebay_item_id).toBe("v1|1|0");
  });

  it("records browse_empty instead of fabricating an ask", () => {
    const rows = observationsFromAdapterResult({
      assetId: randomUUID(),
      holdingId: randomUUID(),
      holdingSourceRowId: "thin-book",
      adapter: { adapterId: "ebay-sold", sales: [], emptyReason: "no eBay items matched" },
      observedAt: new Date(),
      rawSnapshotId: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.observationKind).toBe("browse_empty");
    expect(rows[0]?.askPrice).toBeNull();
  });

  it("refuses persist SQL that would touch sale or CLZ snapshot", () => {
    expect(FORBIDDEN_PERSIST_SQL.test("INSERT INTO vault_market.sale (id) VALUES (1)")).toBe(true);
    expect(
      FORBIDDEN_PERSIST_SQL.test("UPDATE vault_collection.holding SET current_price_snapshot = 12"),
    ).toBe(true);
    expect(() =>
      assertSafePersistSql("UPDATE vault_collection.holding SET current_price_snapshot = 1"),
    ).toThrow(/forbidden SQL/);
    expect(() => assertSafePersistSql("INSERT INTO vault_market.listing_observation (id) VALUES (1)")).not.toThrow();
  });

  it("memory store writes observations without sale or CLZ SQL", async () => {
    const store = memoryListingObservationStore();
    const rows = observationsFromAdapterResult({
      assetId: randomUUID(),
      holdingId: randomUUID(),
      holdingSourceRowId: "h1",
      adapter: listingAdapter(),
      observedAt: new Date(),
      rawSnapshotId: await store.insertSnapshot({
        source: "ebay_browse",
        contentType: "application/json",
        payload: listingAdapter().rawJson ?? "{}",
        recordCount: 1,
        ruleVersion: "test",
      }),
    });
    await store.insertObservations(rows);
    expect(store.observations).toHaveLength(1);
    expect(store.sqlLog.join("\n")).not.toMatch(FORBIDDEN_PERSIST_SQL);
  });
});
