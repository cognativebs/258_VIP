import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  EbayBrowseAdapter,
  liquidityFromActiveCount,
  resetEbayBrowseStateForTests,
} from "../ebay-browse-adapter.js";
import { toPricingSeamResult } from "../market-comps.js";
import { EBAY_BROWSE_ADAPTER_VERSION } from "../../schemas/ebay-browse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "fixtures", "ebay-browse-charizard-sample.json");

describe("EbayBrowseAdapter", () => {
  const dirs: string[] = [];
  afterEach(() => {
    resetEbayBrowseStateForTests();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  function adapter() {
    const snapshotDir = mkdtempSync(join(tmpdir(), "vip-ebay-"));
    dirs.push(snapshotDir);
    return new EbayBrowseAdapter({
      sourceId: "ebay-browse",
      environment: "production",
      marketplaceId: "EBAY_US",
      rateLimitMs: 0,
      snapshotDir,
      defaultLimit: 50,
    });
  }

  it("fixture Browse JSON → ask comps with inferred provenance; snapshot retained", () => {
    const a = adapter();
    const raw = readFileSync(FIXTURE, "utf8");
    const snap = a.writeSnapshot({
      url: "fixture://ebay-browse-charizard",
      query: "Charizard Base Set 4/102",
      assetRef: "asset:charizard-base-4",
      rawJson: raw,
    });
    expect(existsSync(snap.snapshotPath)).toBe(true);

    const bundle = a.parseSnapshot(snap);
    expect(bundle.matchedAsks).toBe(4);
    expect(bundle.liquidity.activeListingCount).toBe(24);
    expect(bundle.low).toBeGreaterThan(0);
    expect(bundle.high).toBeGreaterThanOrEqual(bundle.low);
    expect(bundle.provenance.verificationStatus).toBe("inferred");
    expect(bundle.provenance.method).toBe("ebay-browse-search");
    expect(bundle.provenance.modelVersion).toBe(EBAY_BROWSE_ADAPTER_VERSION);
    expect(bundle.sourceLabel.toLowerCase()).toContain("not sold");
    expect(bundle.asks.some((x) => x.quarantineStatus === "quarantined")).toBe(true);
  });

  it("replay from snapshot file without HTTP", () => {
    const a = adapter();
    const raw = readFileSync(FIXTURE, "utf8");
    const snap = a.writeSnapshot({
      url: "fixture://ebay-browse-charizard",
      query: "Charizard Base Set 4/102",
      rawJson: raw,
    });
    const first = a.parseSnapshot(snap);
    const second = a.parseSnapshotFile(snap.snapshotPath, {
      url: snap.url,
      query: snap.query,
      fetchedAt: snap.fetchedAt,
    });
    expect(second.asks.map((x) => x.id)).toEqual(first.asks.map((x) => x.id));
    expect(second.low).toBe(first.low);
    expect(second.high).toBe(first.high);
  });

  it("dedupes duplicate listing ids", () => {
    const a = adapter();
    const bundle = a.parseSnapshot(
      a.writeSnapshot({
        url: "fixture://x",
        query: "Charizard",
        rawJson: readFileSync(FIXTURE, "utf8"),
      }),
    );
    const ids = bundle.asks
      .filter((x) => x.quarantineStatus === "active")
      .map((x) => x.listingId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("");
  });

  it("empty result → zero range, low confidence, illiquid proxy", () => {
    const a = adapter();
    const empty = JSON.stringify({ total: 0, itemSummaries: [] });
    const bundle = a.parseSnapshot(
      a.writeSnapshot({ url: "fixture://empty", query: "nope", rawJson: empty }),
    );
    expect(bundle.matchedAsks).toBe(0);
    expect(bundle.low).toBe(0);
    expect(bundle.high).toBe(0);
    expect(bundle.liquidity.band).toBe("illiquid");
    expect(bundle.provenance.confidence).toBeLessThanOrEqual(0.15);
  });

  it("API error body quarantines bundle", () => {
    const a = adapter();
    const err = JSON.stringify({
      errors: [{ errorId: 1001, message: "Invalid access token" }],
    });
    const bundle = a.parseSnapshot(
      a.writeSnapshot({ url: "fixture://err", query: "x", rawJson: err }),
    );
    expect(bundle.provenance.verificationStatus).toBe("quarantined");
    expect(bundle.matchedAsks).toBe(0);
  });

  it("toAskSaleComps marks source ebay_browse_ask", () => {
    const a = adapter();
    const bundle = a.parseSnapshot(
      a.writeSnapshot({
        url: "fixture://x",
        query: "Charizard",
        rawJson: readFileSync(FIXTURE, "utf8"),
      }),
    );
    const comps = EbayBrowseAdapter.toAskSaleComps(bundle);
    expect(comps.length).toBe(4);
    expect(comps.every((c) => c.source === "ebay_browse_ask")).toBe(true);
  });

  it("toPricingSeamResult matches getPricing contract shape", () => {
    const a = adapter();
    const bundle = a.parseSnapshot(
      a.writeSnapshot({
        url: "fixture://x",
        query: "Charizard",
        rawJson: readFileSync(FIXTURE, "utf8"),
      }),
    );
    const pricing = toPricingSeamResult(bundle);
    expect(pricing.marketValue).toBeGreaterThan(0);
    expect(pricing.low).toBe(bundle.low);
    expect(pricing.high).toBe(bundle.high);
    expect(pricing.comps.length).toBeGreaterThan(0);
    expect(pricing.comps[0]!.date.startsWith("ask ·")).toBe(true);
    expect(pricing.source.toLowerCase()).toContain("not sold");
    expect(pricing.confidence).toBeGreaterThan(0);
    expect(pricing.confidence).toBeLessThanOrEqual(62);
  });

  it("liquidityFromActiveCount bands", () => {
    expect(liquidityFromActiveCount(0).band).toBe("illiquid");
    expect(liquidityFromActiveCount(2).band).toBe("slow");
    expect(liquidityFromActiveCount(10).band).toBe("medium");
    expect(liquidityFromActiveCount(40).band).toBe("fast");
  });

  it("fromEnv requires credentials for live fetch", async () => {
    const snapshotDir = mkdtempSync(join(tmpdir(), "vip-ebay-env-"));
    dirs.push(snapshotDir);
    const prev = {
      token: process.env.EBAY_OAUTH_TOKEN,
      app: process.env.EBAY_APP_ID,
      cert: process.env.EBAY_CERT_ID,
    };
    delete process.env.EBAY_OAUTH_TOKEN;
    delete process.env.EBAY_APP_ID;
    delete process.env.EBAY_CERT_ID;
    try {
      const a = EbayBrowseAdapter.fromEnv({ snapshotDir, rateLimitMs: 0 });
      await expect(a.fetchAndSnapshot({ query: "test" })).rejects.toThrow(/EBAY_/);
    } finally {
      if (prev.token) process.env.EBAY_OAUTH_TOKEN = prev.token;
      if (prev.app) process.env.EBAY_APP_ID = prev.app;
      if (prev.cert) process.env.EBAY_CERT_ID = prev.cert;
    }
  });
});
