import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSignalsFeed, type SignalsFeed } from "./signalsFeed.js";

function feed(job: string, writtenAt: string, ids: string[], extra: Record<string, string> = {}): SignalsFeed {
  return {
    schema: "vip_signals_feed_v1",
    writtenAt,
    runId: `${job}-run`,
    job,
    provenance: {
      source: job,
      method: "pipeline",
      ruleOrModelVersion: "test@0",
      verificationStatus: "unverified",
    },
    signals: ids.map((id) => ({
      id,
      signalType: "news",
      body: `body ${id}`,
      signalDate: "2026-09-24",
      quarantineStatus: "active",
      ...extra,
    })),
  };
}

function dirWith(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "signals-feed-"));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body), "utf8");
  }
  return dir;
}

describe("readSignalsFeed", () => {
  it("merges signals-feed.<job>.json siblings so jobs never overwrite each other", () => {
    const dir = dirWith({
      "signals-feed.json": feed("pokemon-drops", "2026-09-24T10:00:00.000Z", ["p1", "p2"]),
      "signals-feed.espn-sports.json": feed("espn-sports", "2026-09-24T11:00:00.000Z", ["e1"], {
        sourceId: "espn_rss",
        attribution: "Provided by ESPN",
        sport: "nfl",
      }),
    });
    const merged = readSignalsFeed(join(dir, "signals-feed.json"));
    expect(merged?.signals.map((s) => s.id)).toEqual(["p1", "p2", "e1"]);
    expect(merged?.job).toBe("pokemon-drops + espn-sports");
    expect(merged?.writtenAt).toBe("2026-09-24T11:00:00.000Z");
    expect(merged?.provenance.source).toBe("pokemon-drops");
    const espn = merged?.signals.find((s) => s.id === "e1");
    expect(espn?.attribution).toBe("Provided by ESPN");
    expect(espn?.sourceId).toBe("espn_rss");
  });

  it("reads a sibling when the primary feed is missing, and ignores unrelated files", () => {
    const dir = dirWith({
      "signals-feed.espn-sports.json": feed("espn-sports", "2026-09-24T11:00:00.000Z", ["e1"]),
      "sources-state.json": { sources: {} },
      "signals-feed.bad name.json": feed("x", "2026-09-24T12:00:00.000Z", ["x1"]),
      "signals-feed.broken.json": "{not json",
    });
    const merged = readSignalsFeed(join(dir, "signals-feed.json"));
    expect(merged?.signals.map((s) => s.id)).toEqual(["e1"]);
  });

  it("returns null when there is no feed at all", () => {
    expect(readSignalsFeed(join(dirWith({}), "signals-feed.json"))).toBeNull();
  });
});
