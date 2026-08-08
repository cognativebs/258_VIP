import { describe, expect, it } from "vitest";
import { signalsToEvidenceRefs } from "../evidence-bridge.js";
import { recommend } from "../recommend.js";

describe("evidence-bridge", () => {
  it("AT-07: signals → evidence refs; recommend includes signal id + opposing + range", () => {
    const refs = signalsToEvidenceRefs([
      {
        id: "sig-news-1",
        body: "Official product calendar mention for 30th celebration SKUs.",
        signalType: "news",
        quarantineStatus: "active",
        provenance: { source: "pokemon-news-rss" },
      },
      {
        id: "sig-noise-1",
        body: "Syndicated reprint chatter — likely noise.",
        signalType: "news",
        quarantineStatus: "active",
        provenance: { source: "pokemon-news-rss" },
      },
    ]);
    expect(refs.length).toBe(2);
    expect(refs.some((r) => r.id === "signal:sig-news-1")).toBe(true);

    const rec = recommend({
      assetId: "h1",
      assetName: "Test Holding",
      askPrice: 20,
      sales: [
        {
          id: "s1",
          price: 18,
          saleDate: new Date("2026-07-01"),
          source: "seed",
        },
        {
          id: "s2",
          price: 22,
          saleDate: new Date("2026-07-08"),
          source: "seed",
        },
        {
          id: "s3",
          price: 20,
          saleDate: new Date("2026-07-15"),
          source: "seed",
        },
      ],
      signalEvidence: [
        {
          id: "sig-news-1",
          body: "Official product calendar mention",
          signalType: "news",
          quarantineStatus: "active",
        },
      ],
    });

    const allIds = [
      ...rec.supportingEvidence.map((e) => e.id),
      ...rec.opposingEvidence.map((e) => e.id),
    ];
    expect(allIds).toContain("signal:sig-news-1");
    expect(rec.opposingEvidence.length).toBeGreaterThanOrEqual(1);
    expect(rec.marketRange).not.toBeNull();
    expect(rec.marketRange!.low).toBeLessThanOrEqual(rec.marketRange!.high);
    expect(rec.marketRange!.low).not.toBe(rec.marketRange!.high); // range, not lone point when spread exists
  });

  it("AT-12: zero signals still returns valid recommendation", () => {
    const rec = recommend({
      assetId: "h2",
      assetName: "Empty Signals",
      askPrice: null,
      sales: [],
      signalEvidence: [],
    });
    expect(rec.action).toBeTruthy();
    expect(typeof rec.confidence).toBe("number");
    expect(rec.reasonCodes).toContain("INSUFFICIENT_SIGNAL_EVIDENCE");
    expect(rec.supportingEvidence.length).toBeGreaterThanOrEqual(1);
    expect(rec.opposingEvidence.length).toBeGreaterThanOrEqual(1);
  });
});
