import { describe, expect, it } from "vitest";
import { parseSportsIdentity, sportsParsedCandidate } from "./sportsIdentity.js";

describe("parseSportsIdentity", () => {
  it("extracts year, brand, player, and number from a PaperStream file name", () => {
    const parsed = parseSportsIdentity("1986_topps_michael_jordan_57_front.jpg");
    expect(parsed?.year).toBe(1986);
    expect(parsed?.brand).toBe("Topps");
    expect(parsed?.player).toMatch(/Jordan/i);
    expect(parsed?.collectorNumber).toBe("57");
    expect(parsed?.confidence).toBeLessThanOrEqual(0.72);
  });

  it("parses a non-fixture card so scan ID is not stuck on two sports cards", () => {
    const cand = sportsParsedCandidate("1993_upper_deck_derek_jeter_449_front.jpg");
    expect(cand?.category).toBe("sports");
    expect(cand?.year).toBe(1993);
    expect(cand?.setName).toMatch(/Upper Deck/);
    expect(cand?.playerOrCharacter).toMatch(/Jeter/i);
    expect(cand?.collectorNumber).toBe("449");
    expect(cand?.provenance.verificationStatus).toBe("unverified");
    expect(cand?.provenance.notes).toMatch(/unverified/);
  });

  it("returns null when there is nothing sports-like", () => {
    expect(parseSportsIdentity("img001.jpg")).toBeNull();
  });
});
