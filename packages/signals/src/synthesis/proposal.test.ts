import { describe, expect, it } from "vitest";
import { orchestr8Question, proposeForSignal, type ProposalInput } from "./proposal.js";

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
});
