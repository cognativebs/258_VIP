import { describe, expect, it } from "vitest";
import { briefQuestion, claimKey, gateThesis, parseBriefOutput, resolveCitation, THESIS_CONFIDENCE_CAP, type BriefThesisCandidate } from "./brief.js";
import { calibrationSummary } from "./calibration.js";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const signals = [
  { signalId: S1, domain: "collectibles" },
  { signalId: S2, domain: "sports_cards" },
];
const candidate = (o: Partial<BriefThesisCandidate> = {}): BriefThesisCandidate => ({
  claim: "Delta Reign sealed sells out at MSRP within 30 days",
  horizon_days: 30,
  action: "Watch",
  confidence: 0.5,
  reasons: ["Preorders opened at two outlets"],
  signal_ids: [S1],
  ...o,
});

describe("parseBriefOutput", () => {
  it("keeps the brief when one thesis is malformed and reports the rejection", () => {
    const out = parseBriefOutput({
      headline: "Delta Reign preorders open",
      summary: "Preorders opened.",
      confidence: 0.6,
      sections: [{ group: "Pokémon", points: ["Delta Reign preorders"] }, { group: "bad" }],
      theses: [
        { claim: "Delta Reign sealed sells out within 30 days", horizon_days: "30", action: "watch", confidence: 60, reasons: ["x"], signal_ids: [S1] },
        { claim: "too short", action: "Buy" },
      ],
      thesis_updates: [{ thesis_id: S2, verdict: "Weakened", reason: "reprint announced" }, { thesis_id: "nope", verdict: "holds", reason: "x" }],
    });
    expect(out).not.toBeNull();
    expect(out!.theses).toHaveLength(1);
    expect(out!.theses[0]).toMatchObject({ horizon_days: 30, action: "Watch", confidence: 0.6 });
    expect(out!.thesisUpdates).toEqual([{ thesis_id: S2, verdict: "weakened", reason: "reprint announced" }]);
    expect(out!.sections).toHaveLength(1);
    expect(out!.rejected.map((r) => r.kind)).toEqual(["thesis", "thesis_update"]);
  });

  it("falls back to the prose for the summary and to its first sentence for the headline", () => {
    const out = parseBriefOutput({ confidence: 0.5 }, "Quiet day. Nothing moved.");
    expect(out).toMatchObject({ summary: "Quiet day. Nothing moved.", headline: "Quiet day", theses: [] });
    expect(parseBriefOutput(null, "x")).toBeNull();
    expect(parseBriefOutput({}, "")).toBeNull();
  });
});

describe("gateThesis", () => {
  it("drops a thesis that cites no signal from the brief", () => {
    const r = gateThesis(candidate({ signal_ids: ["33333333-3333-4333-8333-333333333333"] }), signals);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/cites no signal/) });
  });

  it("turns Buy, Sell and Grade into Watch with the proposal withheld while market data is absent", () => {
    for (const action of ["Buy", "Sell", "Grade"] as const) {
      const r = gateThesis(candidate({ action }), signals);
      expect(r.ok && r.draft.action).toBe("Watch");
      expect(r.ok && r.draft.withheld).toEqual([{ action, reason: expect.stringMatching(/sold comps/) }]);
    }
    const kept = gateThesis(candidate({ action: "Buy" }), signals, { marketData: true });
    expect(kept.ok && kept.draft.action).toBe("Buy");
  });

  it("caps confidence, keeps only cited ids from the brief, and takes the domain from them", () => {
    const r = gateThesis(candidate({ confidence: 0.95, signal_ids: [S2.toUpperCase(), "junk", S2], domain: "macro" }), signals);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.confidence).toBe(THESIS_CONFIDENCE_CAP);
    expect(r.draft.reasons.at(-1)).toMatch(/capped/);
    expect(r.draft.signalIds).toEqual([S2]);
    expect(r.draft.domain).toBe("sports_cards");
  });
});

describe("citations", () => {
  const refs = [
    { signalId: S1, domain: "collectibles", ref: "S1" },
    { signalId: S2, domain: "sports_cards", ref: "S2" },
    { signalId: "11111111-2222-4222-8222-222222222222", domain: "macro", ref: "S3" },
  ];

  it("resolves a ref, a full id, or a unique 8+ character prefix, and nothing else", () => {
    expect(resolveCitation("s2", refs)).toBe(S2);
    expect(resolveCitation("[S1]", refs)).toBe(S1);
    expect(resolveCitation(S2.toUpperCase(), refs)).toBe(S2);
    expect(resolveCitation("22222222", refs)).toBe(S2);
    // "11111111" starts two ids: ambiguous, so it cites nothing; short prefixes never count.
    expect(resolveCitation("11111111", refs)).toBeNull();
    expect(resolveCitation("2222", refs)).toBeNull();
    expect(resolveCitation("S9", refs)).toBeNull();
  });

  it("accepts signal_refs from the model and gates on them", () => {
    const parsed = parseBriefOutput({
      summary: "x",
      theses: [{ claim: "Fixture claim long enough", horizon_days: 30, action: "Watch", confidence: 0.5, reasons: ["r"], signal_refs: ["S2"] }],
    });
    const r = gateThesis(parsed!.theses[0]!, refs);
    expect(r.ok && r.draft.signalIds).toEqual([S2]);
  });
});

describe("claimKey and briefQuestion", () => {
  it("matches a claim reworded only in case, accents or punctuation", () => {
    expect(claimKey("Pokémon: Delta-Reign sells OUT!")).toBe(claimKey("pokemon delta reign sells out"));
  });

  it("asks for the JSON block and states the no-price rule", () => {
    const q = briefQuestion({ windowHours: 24, signalCount: 3, openTheses: 1, now: new Date("2026-10-17T12:00:00Z") });
    expect(q).toMatch(/fenced json block/);
    expect(q).toMatch(/news is never a price/);
    expect(q).toMatch(/3 signal\(s\) from the last 24 hours/);
  });
});

describe("calibrationSummary", () => {
  it("scores only measured calls and says when there are too few", () => {
    const s = calibrationSummary([
      { confidence: 0.7, directionCorrect: true },
      { confidence: 0.6, directionCorrect: false },
      { confidence: 0.5, directionCorrect: null },
    ]);
    expect(s).toMatchObject({ resolved: 2, pending: 1, hits: 1, brier: 0.225 });
    expect(s.note).toMatch(/too few/);
    expect(calibrationSummary([]).brier).toBeNull();
  });
});
