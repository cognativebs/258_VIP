import { describe, expect, it } from "vitest";
import { isOwnedForSnapshot, ownedSnapshotSum, type SnapshotHolding } from "./snapshotSum.js";

function row(partial: Partial<SnapshotHolding> & Pick<SnapshotHolding, "id">): SnapshotHolding {
  return {
    currentPrice: 10,
    quantity: 1,
    pillar: "General Inventory",
    soldAt: null,
    salesPathState: "available",
    ...partial,
  };
}

describe("ownedSnapshotSum", () => {
  it("sums each owned holding once and multiplies unit price by quantity", () => {
    expect(
      ownedSnapshotSum([
        row({ id: "a", currentPrice: 10, quantity: 2 }),
        row({ id: "b", currentPrice: 5, quantity: 1 }),
      ]),
    ).toBe(25);
  });

  it("does not add the same holding id twice", () => {
    expect(
      ownedSnapshotSum([
        row({ id: "dup", currentPrice: 40 }),
        row({ id: "dup", currentPrice: 40 }),
      ]),
    ).toBe(40);
  });

  it("excludes Need Binder pockets that reuse the same catalog price", () => {
    expect(
      ownedSnapshotSum([
        row({ id: "owned", pillar: "TCG Owned (Binder)", currentPrice: 12 }),
        row({ id: "need-1", pillar: "TCG Need (Binder)", currentPrice: 12 }),
        row({ id: "need-2", pillar: "TCG Need (Binder)", currentPrice: 12 }),
      ]),
    ).toBe(12);
  });

  it("excludes sold holdings", () => {
    expect(isOwnedForSnapshot(row({ id: "s", salesPathState: "sold" }))).toBe(false);
    expect(ownedSnapshotSum([row({ id: "s", currentPrice: 99, salesPathState: "sold" })])).toBe(0);
  });
});
