import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conditionLabel, fmvCell, fmvDetail, fmvLow, type FmvCard, type FmvRange } from "./pokemonFmv";

const r = (condition: string, low: number, high: number, assumed = false): FmvRange => ({
  condition, conditionAssumed: assumed, low, high, latest: high, latestOn: "2026-10-06", snapshots: 3, recencyDays: 0, confidence: 0.75,
});
const card = (o: Partial<FmvCard> = {}): FmvCard => ({
  externalId: "me1-133",
  name: "Bulbasaur",
  match: { productId: "123", productName: "Bulbasaur #133", needsReview: false },
  fmv: [r("NM", 15, 19, true), r("GRADE_9_5", 60, 60), r("PSA_10", 107.3, 107.3)],
  ...o,
});

describe("pokemon FMV display", () => {
  it("shows the ungraded range first, then PSA 10, with snapshots, age and confidence", () => {
    assert.equal(fmvCell(card()), "NM assumed $15.00–$19.00 · PSA 10 $107.30 · 3× · 0d · conf 0.75");
    assert.equal(fmvLow(card()), 15);
    assert.equal(conditionLabel({ condition: "GRADE_9_5", conditionAssumed: false }), "Grade 9.5");
  });

  it("never prices a card whose match needs review, and says what is missing", () => {
    const review = card({ match: { productId: "9", productName: "Bulbasaur [Reverse Holo] #133", needsReview: true } });
    assert.equal(fmvCell(review), "match needs review");
    assert.equal(fmvLow(review), null);
    assert.match(fmvDetail(review)[1]!, /job:pokemon-prices -- confirm me1-133 9 --confirm-operator/);
    assert.equal(fmvCell(undefined), "not priced");
    assert.equal(fmvCell(card({ match: null })), "no PriceCharting match");
    assert.equal(fmvCell(card({ fmv: [] })), "no guide snapshot yet");
  });

  it("the detail lists every condition and says it is a guide, not sold comps", () => {
    const lines = fmvDetail(card());
    assert.equal(lines.length, 4);
    assert.match(lines[0]!, /^NM assumed: \$15.00–\$19.00 · latest \$19.00 on 2026-10-06/);
    assert.match(lines.at(-1)!, /Not sold comps\.$/);
  });
});
