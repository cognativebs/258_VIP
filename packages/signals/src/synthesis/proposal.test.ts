import { describe, expect, it } from "vitest";
import { guideSummary, orchestr8Question, proposeForSignal, type GuideRange, type ProposalInput } from "./proposal.js";

const base: ProposalInput = {
  title: "“Fixture Rise” Preorders Now Live",
  theme: "PREORDER",
  band: "emerging",
  direction: "mixed",
  independentSourceCount: 1,
  method: "inferred",
  baseConfidence: 0.54,
  exposure: { owned: 0, wishlist: 0, hunts: [], matched: [] },
  marketConfirmed: false,
};
const propose = (o: Partial<ProposalInput>) => proposeForSignal({ ...base, ...o, exposure: { ...base.exposure, ...(o.exposure ?? {}) } });

describe("proposeForSignal", () => {
  it("noise is Pass; a watch-band signal with no exposure is Pass with the reason", () => {
    expect(propose({ band: "noise" })).toMatchObject({ action: "Pass", reasons: expect.arrayContaining(["Below the Watch band"]) });
    expect(propose({ band: "watch" })).toMatchObject({ action: "Pass", reasons: expect.arrayContaining([expect.stringMatching(/No exposure/)]) });
  });

  it("owned copies mean Hold; Sell or Grade is withheld until market data exists", () => {
    const down = propose({ theme: "REPRINT", direction: "down", exposure: { owned: 2, wishlist: 0, hunts: [], matched: ["Fixtureon ex · Fixture Rise"] } });
    expect(down).toMatchObject({ action: "Hold", withheld: [{ action: "Sell", reason: expect.stringMatching(/sold comps/) }] });
    expect(down.reasons).toEqual(expect.arrayContaining(["You own 2 matching cards", "Matches your collection: Fixtureon ex · Fixture Rise"]));
    const up = propose({ theme: "CARD_REVEAL", direction: "up", exposure: { owned: 1, wishlist: 0, hunts: [], matched: [] } });
    expect(up.withheld.map((w) => w.action)).toEqual(["Grade"]);
  });

  it("wishlist or hunt overlap means Watch with targets; Buy is never proposed without market data", () => {
    const p = propose({ exposure: { owned: 0, wishlist: 1, hunts: ["Pokémon 30th Celebration"], matched: [] } });
    expect(p).toMatchObject({ action: "Watch", trigger: "Notify when it is available at MSRP" });
    expect(p.tags.sort()).toEqual(["binder_target", "hunt_target", "sealed_target"]);
    expect(p.withheld).toEqual([{ action: "Buy", reason: expect.stringMatching(/sold comps/) }]);
    for (const band of ["watch", "emerging", "strong", "high_conviction"] as const) {
      expect(propose({ band, exposure: { owned: 0, wishlist: 3, hunts: [], matched: [] } }).action).not.toBe("Buy");
    }
  });

  it("strong enough with no exposure is Watch; research themes are tagged; opinion is capped at Watch", () => {
    expect(propose({ theme: "PULL_RATE", band: "strong" })).toMatchObject({ action: "Watch", tags: ["research"] });
    const opinion = propose({ theme: "REPRINT", band: "strong", method: "opinion" });
    expect(opinion.action).toBe("Watch");
    expect(opinion.reasons).toEqual(expect.arrayContaining(["From creator opinion, not reported fact"]));
  });

  it("the Orchestr8 question carries the proposal, exposure, withheld actions and the market rule", () => {
    const input = { ...base, exposure: { owned: 0, wishlist: 1, hunts: ["Fixture Hunt"], matched: [] } };
    const q = orchestr8Question(input, proposeForSignal(input));
    expect(q).toMatch(/SIGNALS proposes Watch \[binder_target, hunt_target, sealed_target\]/);
    expect(q).toMatch(/Exposure: owned 0, wishlist 1, hunts Fixture Hunt/);
    expect(q).toMatch(/Withheld: Buy/);
    expect(q).toMatch(/Buy, Sell or Grade only with market evidence/);
  });

  it("attaches guide ranges as evidence; Buy / Sell / Grade stay withheld and say why", () => {
    const g = (condition: string, low: number, high: number, assumed = false): GuideRange => ({
      externalId: "me1-133", card: "Bulbasaur", condition, conditionAssumed: assumed, low, high, snapshots: 3, recencyDays: 0, confidence: 0.75,
    });
    const guide = [g("NM", 15, 19, true), g("GRADE_9", 40, 44), g("PSA_10", 107, 107)];
    expect(guideSummary(guide)).toEqual(["Bulbasaur NM assumed $15.00–$19.00 · PSA 10 $107 (3 snapshots, 0d)"]);

    const owned = propose({ direction: "up", guide, exposure: { owned: 1, wishlist: 0, hunts: [], matched: ["Bulbasaur · Mega Evolution"] } });
    expect(owned.action).toBe("Hold");
    expect(owned.guide).toEqual(guide);
    expect(owned.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^PriceCharting guide \(not sold comps\): Bulbasaur/)]));
    expect(owned.withheld).toEqual([{ action: "Grade", reason: expect.stringMatching(/guide range attached .*not sold comps.*still needs sold comps/) }]);

    const wanted = propose({ guide, exposure: { owned: 0, wishlist: 1, hunts: [], matched: [] } });
    expect(wanted.action).toBe("Watch");
    expect(wanted.withheld.map((w) => w.action)).toEqual(["Buy"]);
    expect(wanted.withheld[0]!.reason).not.toMatch(/and a price/);
    const q = orchestr8Question({ ...base, guide }, proposeForSignal({ ...base, guide }));
    expect(q).toMatch(/PriceCharting guide for the matched cards \(vendor guide, confidence ≤ 0.75, not sold comps\): Bulbasaur/);

    expect(propose({}).guide).toEqual([]);
  });
});
