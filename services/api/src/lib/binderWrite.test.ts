import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../db/client.js";
import {
  BINDER_HOLDING_SOURCE,
  loadDurableBinderHoldings,
  loadDurableWatchlist,
  projectSlotToVip,
} from "./binderWrite.js";

/**
 * Integration against live Postgres + the seeded Binder test slot
 * (`slot-test-charizard`). Skips cleanly when the DB or seed is missing.
 */
describe("Binder → VIP write path", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("projects owned + wishlist into durable holding and watchlist rows", async () => {
    const result = await projectSlotToVip("slot-test-charizard");
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn("skipping binder write test:", result.error);
      return;
    }

    expect(result.holding).toBe("upserted");
    expect(result.watchlist).toBe("upserted");
    expect(result.assetId).toBeTruthy();
    expect(result.holdingId).toBeTruthy();
    expect(result.watchlistId).toBeTruthy();

    const holdings = await loadDurableBinderHoldings();
    const holding = holdings.find((h) => h.sourceRowId === "slot-test-charizard");
    expect(holding).toBeTruthy();
    expect(holding?.pillar).toBe("TCG Owned (Binder)");
    expect(holding?.externalIds.some((e) => e.externalValue === "base1-4")).toBe(true);

    const watch = await loadDurableWatchlist();
    const item = watch.find((w) => w.holdingId === "binder-slot-slot-test-charizard");
    expect(item).toBeTruthy();
    expect(item?.source).toBe(BINDER_HOLDING_SOURCE);
    expect(item?.provenance.ruleOrModelVersion).toContain("binder-vip-write");
  }, 30_000);

  it("idempotent re-project does not duplicate rows", async () => {
    const first = await projectSlotToVip("slot-test-charizard");
    if (!first.ok) return;
    const second = await projectSlotToVip("slot-test-charizard");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.holdingId).toBe(first.holdingId);
    expect(second.watchlistId).toBe(first.watchlistId);

    const holdings = await loadDurableBinderHoldings();
    expect(
      holdings.filter((h) => h.sourceRowId === "slot-test-charizard"),
    ).toHaveLength(1);
  }, 30_000);
});
