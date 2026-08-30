import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeSignalsFeed } from "./signalsFeed.js";
import { basicSignalsOutput, compactSignalsContext } from "./signalsContext.js";

describe("compactSignalsContext", () => {
  it("omits the block when the feed is missing", () => {
    const ctx = compactSignalsContext(join(tmpdir(), "vip-no-such-signals.json"));
    expect(ctx.active).toEqual([]);
    expect(ctx.feedKind).toBe("empty");
    expect(ctx.provenance.verificationStatus).toBe("unverified");
  });

  it("includes active items and excludes quarantined from the prompt slice", () => {
    const dir = mkdtempSync(join(tmpdir(), "vip-signals-ctx-"));
    const path = join(dir, "signals-feed.json");
    writeSignalsFeed(path, {
      schema: "vip_signals_feed_v1",
      writtenAt: "2026-08-29T00:00:00.000Z",
      runId: "run-1",
      job: "pokemon-drops",
      provenance: {
        source: "pokemon-news-rss",
        method: "inferred",
        ruleOrModelVersion: "signals@0.1.0",
        verificationStatus: "unverified",
      },
      signals: [
        {
          id: "a",
          signalType: "news",
          body: "Live drop",
          signalDate: "2026-08-29",
          quarantineStatus: "active",
          title: "Drop",
        },
        {
          id: "q",
          signalType: "news",
          body: "Noise",
          signalDate: "2026-08-29",
          quarantineStatus: "quarantined",
          title: "Spam",
        },
      ],
    });
    const ctx = compactSignalsContext(path);
    expect(ctx.active.map((s) => s.id)).toEqual(["a"]);
    expect(ctx.quarantinedCount).toBe(1);
    expect(ctx.provenance.notes).toMatch(/not a market fact/);
  });
});

describe("basicSignalsOutput", () => {
  it("maps reprint headlines to Hold / personal — never a price", () => {
    const out = basicSignalsOutput([
      {
        id: "r1",
        signalType: "reprint",
        body: "Charizard reprint rumor",
        signalDate: "2026-08-29",
        quarantineStatus: "active",
        title: "Reprint",
      },
    ]);
    expect(out[0]?.action).toBe("Hold");
    expect(out[0]?.bucketHint).toBe("personal_collection");
    expect(JSON.stringify(out)).not.toMatch(/\$\d/);
  });
});
