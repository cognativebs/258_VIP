import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSourceStats, SourcesListSchema } from "./sourcesApi";

describe("sources editor", () => {
  it("shows unknown stats as unknown, never zero", () => {
    const out = formatSourceStats(undefined);
    assert.equal(out.signals, "—");
    assert.equal(out.quarantine, "—");
    assert.equal(out.evidence, "—");
    assert.match(out.method, /Not attributed/);
  });

  it("formats attributed stats with their method", () => {
    const out = formatSourceStats({
      signalCount: 8,
      quarantineRate: 0.25,
      evidenceCount: 6,
      method: "signals-feed signalType proxy@0.1.0 (signalType=news)",
    });
    assert.deepEqual(
      [out.signals, out.quarantine, out.evidence],
      ["8", "25%", "6"],
    );
    assert.match(out.method, /signalType=news/);
  });

  it("does not show a quarantine rate over zero signals", () => {
    assert.equal(formatSourceStats({ signalCount: 0, quarantineRate: 0 }).quarantine, "—");
  });

  it("parses the API list shape", () => {
    const parsed = SourcesListSchema.parse({
      sources: [
        {
          id: "pokemon-news-rss",
          name: "News",
          label: "News",
          authority: "news",
          accessMethod: "rss",
          categoryCoverage: ["pokemon"],
          terms: "Respect feed ToS",
          historicalAccuracy: 0.55,
          latencyHours: 6,
          active: true,
        },
      ],
    });
    assert.equal(parsed.sources[0]?.stats, undefined);
    assert.equal(SourcesListSchema.safeParse({ sources: [{ id: "x" }] }).success, false);
  });
});
