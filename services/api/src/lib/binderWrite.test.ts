import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "../db/client.js";
import {
  BINDER_HOLDING_SOURCE,
  loadDurableBinderHoldings,
  loadDurableWatchlist,
  projectSlotToVip,
  slotProvenance,
  type BinderSlotPayload,
} from "./binderWrite.js";

const slot = (over: Partial<BinderSlotPayload>): BinderSlotPayload => ({
  slotId: "s1", binderId: "b1", binderName: "B", pageTitle: "", pageIndex: 0, roleLabel: "",
  source: "tcgdex", externalId: "base1-4", cardName: "Charizard", setName: "Base", number: "4",
  rarity: null, imageUrl: null, priceMarket: null, owned: true, onWishlist: false,
  provenanceSource: null, provenanceMethod: null, provenanceModelVersion: null,
  confidence: null, verificationStatus: null,
  ...over,
});

describe("slotProvenance (sent with every Binder → VIP write)", () => {
  it("passes Binder's recorded provenance through on the shared contract", () => {
    expect(
      slotProvenance(slot({ provenanceSource: "tcgdex", provenanceMethod: "api", provenanceModelVersion: "tcgdex-v2", confidence: 0.9, verificationStatus: "verified" })),
    ).toEqual({ source: "tcgdex", method: "observed", ruleOrModelVersion: "tcgdex-v2", confidence: 0.9, verificationStatus: "verified" });
  });

  it("no recorded provenance: inferred, unversioned, confidence 0 (was observed / 0.7)", () => {
    expect(slotProvenance(slot({}))).toMatchObject({
      source: "binder-vault",
      method: "inferred",
      ruleOrModelVersion: "binder-vault:unversioned",
      confidence: 0,
      confidenceBand: "low",
      verificationStatus: "unverified",
    });
  });
});

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
    expect(holding?.cardName).toMatch(/Charizard/i);
    expect(holding?.coverImageUrl).toBeTruthy();

    const watch = await loadDurableWatchlist();
    const item = watch.find((w) => w.holdingId === "binder-slot-slot-test-charizard");
    expect(item).toBeTruthy();
    expect(item?.source).toBe(BINDER_HOLDING_SOURCE);
    expect(item?.provenance.ruleOrModelVersion).toContain("binder-vip-write");
  }, 30_000);

  it("idempotent re-project does not duplicate rows", async () => {
    const first = await projectSlotToVip("slot-test-charizard");
    if (!first.ok) {
      // eslint-disable-next-line no-console
      console.warn("skipping binder write idempotency test:", first.error);
      return;
    }
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
