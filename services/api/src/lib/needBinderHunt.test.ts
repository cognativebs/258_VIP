import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import type { ApiHolding } from "./holdings.js";
import {
  NEED_BINDER_HUNT_ID,
  binderNameFromNotes,
  buildNeedBinderHunt,
  needBinderHuntMetrics,
  needBinderHuntPayload,
  needBinderPriority,
} from "./needBinderHunt.js";

function holding(partial: Partial<ApiHolding> & Pick<ApiHolding, "id" | "pillar">): ApiHolding {
  return {
    assetName: "Base Set #4 Charizard",
    series: "Base Set",
    issue: "4",
    publisher: "The Pokémon Company",
    quantity: 1,
    museumScore: null,
    investmentScore: null,
    liquidityScore: null,
    recommendationLabel: "Hunt",
    sellPriority: null,
    needsGrading: false,
    needsPhoto: false,
    needsVerification: true,
    verificationNotes: "Binder: Promo Binder · Still needed",
    currentPrice: 40,
    assumedGrade: null,
    gradeRating: null,
    coverImageUrl: null,
    cardName: "Charizard",
    rarity: "Rare",
    externalIds: [],
    provenance: markInferred({
      source: "binder-vault",
      ruleOrModelVersion: "test@0",
      notes: "fixture",
    }),
    ...partial,
  };
}

describe("need binder hunt", () => {
  it("reads the binder name from provenance notes", () => {
    expect(binderNameFromNotes("Binder: Promo Binder · Page 1")).toBe("Promo Binder");
    expect(binderNameFromNotes(null)).toBe("Need Binder");
  });

  it("ranks buy priority from market without inventing a point value", () => {
    expect(needBinderPriority(null)).toBe("medium");
    expect(needBinderPriority(4)).toBe("low");
    expect(needBinderPriority(25)).toBe("high");
    expect(needBinderPriority(100)).toBe("critical");
  });

  it("builds a hunt from Need Binder holdings only", () => {
    const hunt = buildNeedBinderHunt([
      holding({ id: "need-1", pillar: "TCG Need (Binder)" }),
      holding({
        id: "owned-1",
        pillar: "TCG Owned (Binder)",
        cardName: "Pikachu",
        recommendationLabel: "Hold",
      }),
    ]);
    expect(hunt.id).toBe(NEED_BINDER_HUNT_ID);
    expect(hunt.name).toBe("Pokémon Need Binder");
    expect(hunt.sections).toHaveLength(1);
    expect(hunt.sections[0]?.name).toBe("Promo Binder");
    expect(hunt.sections[0]?.items.map((i) => i.id)).toEqual(["need-1"]);
    expect(hunt.sections[0]?.items[0]?.status).toBe("missing");
  });

  it("counts owned vs missing for completion and leaves need cards as the list", () => {
    const holdings = [
      holding({ id: "need-1", pillar: "TCG Need (Binder)" }),
      holding({ id: "owned-1", pillar: "TCG Owned (Binder)" }),
      holding({ id: "owned-2", pillar: "TCG Owned (Binder)" }),
    ];
    const payload = needBinderHuntPayload(holdings);
    expect(payload.metrics).toEqual({
      owned: 2,
      wanted: 0,
      missing: 1,
      total: 3,
      completionPct: 66.7,
    });
    expect(needBinderHuntMetrics([]).total).toBe(0);
    expect(needBinderHuntMetrics([]).completionPct).toBe(0);
  });
});
