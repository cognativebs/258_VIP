import { describe, expect, it } from "vitest";
import {
  classifyInventoryBucket,
  bucketSellPolicy,
  inventoryBucketLabel,
  INVENTORY_BUCKET_RULE,
} from "./inventory-bucket.js";

describe("classifyInventoryBucket", () => {
  it("puts Batman / Spider-Man / art female covers in Personal Collection", () => {
    expect(classifyInventoryBucket({ pillar: "Batman" }).bucket).toBe("personal_collection");
    expect(classifyInventoryBucket({ pillar: "Spider-Man" }).bucket).toBe(
      "personal_collection",
    );
    expect(classifyInventoryBucket({ pillar: "Good Girl / Risqué Covers" }).bucket).toBe(
      "personal_collection",
    );
    expect(classifyInventoryBucket({ pillar: "Cover Art & Favorite Artists" }).bucket).toBe(
      "personal_collection",
    );
  });

  it("puts Investment Portfolio and keys in Investment Vault", () => {
    expect(classifyInventoryBucket({ pillar: "Investment Portfolio" }).bucket).toBe(
      "investment_vault",
    );
    expect(classifyInventoryBucket({ pillar: "First Appearances" }).bucket).toBe(
      "investment_vault",
    );
    expect(classifyInventoryBucket({ pillar: "Bronze & Silver Age Keys" }).bucket).toBe(
      "investment_vault",
    );
  });

  it("puts General Inventory in Dealer Inventory", () => {
    const row = classifyInventoryBucket({ pillar: "General Inventory" });
    expect(row.bucket).toBe("dealer_inventory");
    expect(row.assignment).toBe("inferred");
    expect(row.verificationStatus).toBe("unverified");
    expect(row.ruleOrModelVersion).toBe(INVENTORY_BUCKET_RULE);
  });

  it("Museum Candidate wins over General Inventory", () => {
    expect(
      classifyInventoryBucket({
        pillar: "General Inventory",
        recommendation: "Museum Candidate",
      }).bucket,
    ).toBe("personal_collection");
  });

  it("value_locked stays personal even on a sell recommendation", () => {
    expect(
      classifyInventoryBucket({
        pillar: "General Inventory",
        recommendation: "Sell Duplicate",
        valueLocked: true,
      }).bucket,
    ).toBe("personal_collection");
  });

  it("does not move a Batman duplicate into dealer (not for routine sale)", () => {
    expect(
      classifyInventoryBucket({
        pillar: "Batman",
        recommendation: "Sell Duplicate",
      }).bucket,
    ).toBe("personal_collection");
  });
});

describe("bucketSellPolicy", () => {
  it("blocks routine sale on personal collection", () => {
    const p = bucketSellPolicy("personal_collection");
    expect(p.routineSale).toBe(false);
    expect(p.reasonCode).toBe("PERSONAL_COLLECTION_NOT_FOR_SALE");
    expect(inventoryBucketLabel(p.bucket)).toBe("Personal Collection");
  });

  it("requires intelligence for investment vault", () => {
    const p = bucketSellPolicy("investment_vault");
    expect(p.routineSale).toBe(false);
    expect(p.sellWhenIntelligenceJustifies).toBe(true);
  });

  it("marks dealer inventory as churn capital", () => {
    const p = bucketSellPolicy("dealer_inventory");
    expect(p.churnCapital).toBe(true);
    expect(p.routineSale).toBe(true);
  });
});
