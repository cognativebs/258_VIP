import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { RssAdapter } from "../rss-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "fixtures", "pokemon-news-sample.xml");

describe("RssAdapter", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  function adapter() {
    const snapshotDir = mkdtempSync(join(tmpdir(), "vip-rss-"));
    dirs.push(snapshotDir);
    return new RssAdapter({
      feedUrl: "fixture://pokemon-news-sample",
      sourceId: "pokemon-news-rss",
      rateLimitMs: 0,
      snapshotDir,
    });
  }

  it("AT-01: fixture RSS → signals with provenance; snapshot retained", () => {
    const a = adapter();
    const xml = readFileSync(FIXTURE, "utf8");
    const snap = a.writeSnapshot("fixture://pokemon-news-sample", xml);
    expect(existsSync(snap.snapshotPath)).toBe(true);
    const signals = a.parseSnapshot(snap);
    const active = signals.filter((s) => s.quarantineStatus === "active");
    expect(active.length).toBeGreaterThanOrEqual(1);
    for (const s of active) {
      expect(s.provenance.source).toBe("pokemon-news-rss");
      expect(s.provenance.method).toBe("rss-parse");
      expect(s.provenance.modelVersion).toBe("signals@rss-v1");
      expect(s.provenance.verificationStatus).toBe("inferred");
    }
  });

  it("AT-02: replay from snapshot file without HTTP", () => {
    const a = adapter();
    const xml = readFileSync(FIXTURE, "utf8");
    const snap = a.writeSnapshot("fixture://pokemon-news-sample", xml);
    const first = a.parseSnapshot(snap);
    const second = a.parseSnapshotFile(snap.snapshotPath, snap.url);
    expect(second.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(second.map((s) => s.provenance.modelVersion)).toEqual(
      first.map((s) => s.provenance.modelVersion),
    );
  });

  it("AT-08: malformed item quarantined", () => {
    const a = adapter();
    const xml = readFileSync(FIXTURE, "utf8");
    const signals = a.parseSnapshot(a.writeSnapshot("fixture://x", xml));
    expect(signals.some((s) => s.quarantineStatus === "quarantined")).toBe(true);
    expect(
      signals
        .filter((s) => s.quarantineStatus === "quarantined")
        .every((s) => s.provenance.verificationStatus === "quarantined"),
    ).toBe(true);
  });

  it("AT-10: empty feed returns []", () => {
    const a = adapter();
    const empty =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';
    const signals = a.parseSnapshot(a.writeSnapshot("fixture://empty", empty));
    expect(signals).toEqual([]);
  });

  it("AT-11: duplicate guid emits one active signal", () => {
    const a = adapter();
    const xml = readFileSync(FIXTURE, "utf8");
    const signals = a.parseSnapshot(a.writeSnapshot("fixture://x", xml));
    const reprint = signals.filter((s) => s.guid === "fixture-guid-reprint-chatter");
    expect(reprint).toHaveLength(1);
  });
});
