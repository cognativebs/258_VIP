import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FEED_FILE,
  fetchPokemonDropObservations,
  formatDeltaReport,
  runPokemonDropsJob,
} from "./pokemon-drops.js";
import { runSignalPipeline } from "@vip/signals";

describe("Phase 4 gate — zero-touch Pokémon drops", () => {
  it("completes with no manual trigger and emits a what-changed delta", () => {
    const { delta } = runPokemonDropsJob({
      triggeredBy: "schedule",
      now: new Date("2026-07-21T15:00:00Z"),
      persist: false,
      priorSignalBodies: [],
    });

    expect(delta.job).toBe("pokemon-drops");
    expect(delta.triggeredBy).toBe("schedule");
    expect(delta.runId).toBeTruthy();
    expect(delta.whatChanged.quarantined).toBeGreaterThanOrEqual(1);
    expect(delta.whatChanged.newSignals).toBeGreaterThanOrEqual(1);

    const text = formatDeltaReport(delta);
    expect(text).toContain("whatChanged");
    expect(text).toContain("Zero-touch");
  });

  it("second pass against prior bodies quarantines recycled chatter", () => {
    const first = runPokemonDropsJob({
      triggeredBy: "schedule",
      now: new Date("2026-07-21T15:00:00Z"),
      persist: false,
    });

    const priorBodies = first.delta.whatChanged.newTitles.length
      ? fetchPokemonDropObservations(new Date("2026-07-21T15:00:00Z"))
          .filter((e) => e.externalId?.startsWith("etb-"))
          .map((e) => e.body)
      : [];

    // Feed day-1 bodies as prior; recycle reprint chatter → quarantine
    const prior = [
      ...priorBodies,
      "Syndicated reprint chatter recirculating without new SKUs — likely noise.",
    ];

    const second = runSignalPipeline(
      fetchPokemonDropObservations(new Date("2026-07-22T15:00:00Z")),
      { priorSignalBodies: prior },
    );

    expect(second.delta.quarantined).toBeGreaterThanOrEqual(1);
    expect(second.delta.newSignals + second.delta.quarantined).toBeGreaterThan(0);
  });

  it("persists signals-feed.json for VIP API", () => {
    if (existsSync(FEED_FILE)) unlinkSync(FEED_FILE);
    runPokemonDropsJob({
      triggeredBy: "test",
      now: new Date("2026-08-02T18:00:00Z"),
      persist: true,
    });
    expect(existsSync(FEED_FILE)).toBe(true);
    const feed = JSON.parse(readFileSync(FEED_FILE, "utf8")) as {
      schema: string;
      signals: unknown[];
    };
    expect(feed.schema).toBe("vip_signals_feed_v1");
    expect(feed.signals.length).toBeGreaterThan(0);
  });
});
