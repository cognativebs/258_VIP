import { describe, expect, it } from "vitest";
import { normalizeTrafficRecords } from "./analytics.js";

describe("analytics traffic ingestion", () => {
  it("maps listing-level impressions/views and leaves watcher/offer null", () => {
    const snaps = normalizeTrafficRecords(
      new Map([["LST-1", "44444444-4444-4444-8444-444444444444"]]),
      {
        records: [
          {
            listingId: "LST-1",
            metricValues: [
              { metricType: "LISTING_IMPRESSION_TOTAL", value: 120 },
              { metricType: "LISTING_VIEWS_TOTAL", value: 18 },
            ],
          },
        ],
      },
    );
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.impressionsTotal).toBe(120);
    expect(snaps[0]?.viewsTotal).toBe(18);
    expect(snaps[0]?.watcherCount).toBeNull();
    expect(snaps[0]?.offerCount).toBeNull();
    expect(snaps[0]?.dataSource).toBe("ebay_analytics_traffic_report");
  });
});
