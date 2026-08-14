import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatEbayBrowseReport, runEbayBrowseCompsJob } from "./ebay-browse-comps.js";

describe("ebay-browse-comps job", () => {
  const dirs: string[] = [];
  const prevFeed = process.env.VIP_EBAY_COMPS_FEED;
  const prevFixture = process.env.VIP_EBAY_FIXTURE;

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    if (prevFeed === undefined) delete process.env.VIP_EBAY_COMPS_FEED;
    else process.env.VIP_EBAY_COMPS_FEED = prevFeed;
    if (prevFixture === undefined) delete process.env.VIP_EBAY_FIXTURE;
    else process.env.VIP_EBAY_FIXTURE = prevFixture;
  });

  it("fixture mode writes comps feed with provenance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vip-ebay-job-"));
    dirs.push(dir);
    process.env.VIP_EBAY_COMPS_FEED = join(dir, "feed.json");
    delete process.env.VIP_EBAY_FIXTURE;
    delete process.env.EBAY_OAUTH_TOKEN;
    delete process.env.EBAY_APP_ID;

    const result = await runEbayBrowseCompsJob({
      query: "Charizard Base Set 4/102",
      triggeredBy: "test",
    });
    expect(result.mode).toBe("fixture");
    expect(result.bundle.matchedAsks).toBeGreaterThan(0);
    const feed = JSON.parse(readFileSync(result.feedPath, "utf8"));
    expect(feed.schema).toBe("vip_ebay_comps_feed_v1");
    expect(feed.pricing.comps.length).toBeGreaterThan(0);
    expect(feed.provenance.verificationStatus).toBe("inferred");
    expect(formatEbayBrowseReport(result)).toContain("ebay-browse-comps");
  });
});
