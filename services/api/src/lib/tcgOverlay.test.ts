import { describe, expect, it } from "vitest";
import type { ApiHolding } from "./holdings.js";
import { markObserved } from "@vip/evidence";
import { liveBinderBySlotId, overlayBinderDisplay } from "./tcgOverlay.js";

function holding(partial: Partial<ApiHolding> & Pick<ApiHolding, "id" | "assetName">): ApiHolding {
  return {
    series: "",
    issue: "",
    publisher: "The Pokémon Company",
    quantity: 1,
    pillar: "TCG Owned (Binder)",
    museumScore: null,
    investmentScore: null,
    liquidityScore: null,
    recommendationLabel: "Hold",
    sellPriority: "Low",
    needsGrading: false,
    needsPhoto: false,
    needsVerification: true,
    verificationNotes: null,
    currentPrice: null,
    assumedGrade: null,
    gradeRating: null,
    coverImageUrl: null,
    cardName: null,
    rarity: null,
    externalIds: [],
    provenance: markObserved({
      source: "test",
      ruleOrModelVersion: "test@0",
      confidence: 0.5,
    }),
    ...partial,
  };
}

describe("overlayBinderDisplay", () => {
  it("copies live Binder cardName onto a durable holding that lost it", () => {
    const durable = holding({
      id: "uuid-1",
      assetName: "Unnamed card",
      cardName: null,
      series: "Base Set",
      issue: "4",
    });
    const live = holding({
      id: "binder-slot-slot-1",
      assetName: "Base Set #4 Charizard",
      cardName: "Charizard",
      coverImageUrl: "https://images.pokemontcg.io/base1/4.png",
      series: "Base Set",
      issue: "4",
    });
    const out = overlayBinderDisplay(durable, live);
    expect(out.cardName).toBe("Charizard");
    expect(out.coverImageUrl).toBe("https://images.pokemontcg.io/base1/4.png");
    expect(out.id).toBe("uuid-1");
  });

  it("leaves the durable row unchanged when there is no live slot", () => {
    const durable = holding({ id: "uuid-1", assetName: "Pikachu", cardName: "Pikachu" });
    expect(overlayBinderDisplay(durable, undefined).cardName).toBe("Pikachu");
  });
});

describe("liveBinderBySlotId", () => {
  it("indexes binder-slot holdings by pocket id", () => {
    const map = liveBinderBySlotId([
      holding({ id: "binder-slot-abc", assetName: "x", cardName: "Pikachu" }),
      holding({ id: "not-a-slot", assetName: "y" }),
    ]);
    expect(map.get("abc")?.cardName).toBe("Pikachu");
    expect(map.has("not-a-slot")).toBe(false);
  });
});
