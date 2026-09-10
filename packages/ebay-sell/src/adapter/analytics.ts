import type { EbayHttpClient } from "./client.js";
import type { ListingMetricSnapshot } from "../schemas.js";
import { randomUUID } from "node:crypto";

export type TrafficWindow = {
  from: Date;
  to: Date;
  listingIds: string[];
};

/**
 * Traffic Report is not an unlimited firehose. Callers must pass a date window
 * and a listing-id batch. Failures here must not break order processing.
 */
export function createAnalyticsAdapter(client: EbayHttpClient) {
  return {
    async trafficReport(window: TrafficWindow, marketplaceId = "EBAY_US") {
      if (window.listingIds.length === 0) {
        return { ok: true, status: 200, errorClass: null, errorMessage: null, body: { records: [] } };
      }
      const ids = window.listingIds.slice(0, 20);
      const from = formatDay(window.from);
      const to = formatDay(window.to);
      const filter = [
        `marketplace_ids:{${marketplaceId}}`,
        `date_range:[${from}..${to}]`,
        `listing_ids:{${ids.join(",")}}`,
      ].join(",");
      const params = new URLSearchParams({
        dimension: "LISTING",
        metric: "LISTING_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL",
        filter,
      });
      return client.request({
        method: "GET",
        path: `/sell/analytics/v1/traffic_report?${params.toString()}`,
        idempotencyKey: `traffic:${from}:${to}:${ids.join(",")}`,
      });
    },
  };
}

export function normalizeTrafficRecords(
  marketplaceListingByEbayId: Map<string, string>,
  payload: unknown,
  capturedAt = new Date(),
): ListingMetricSnapshot[] {
  const records = extractRecords(payload);
  const out: ListingMetricSnapshot[] = [];
  for (const rec of records) {
    const listingId = rec.listingId ?? rec.dimensionValues?.[0]?.value;
    const marketplaceListingId = listingId ? marketplaceListingByEbayId.get(listingId) : undefined;
    if (!marketplaceListingId) continue;
    const metrics = rec.metricValues ?? rec.metrics ?? [];
    const impressions = metric(metrics, "LISTING_IMPRESSION_TOTAL");
    const views = metric(metrics, "LISTING_VIEWS_TOTAL");
    out.push({
      id: randomUUID(),
      marketplaceListingId,
      capturedAt,
      impressionsSearch: null,
      impressionsStore: null,
      impressionsTotal: impressions,
      viewsTotal: views,
      viewsSearch: null,
      viewsStore: null,
      viewsDirect: null,
      viewsOffEbay: null,
      watcherCount: null,
      offerCount: null,
      dataSource: "ebay_analytics_traffic_report",
    });
  }
  return out;
}

function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function extractRecords(payload: unknown): Record<string, any>[] {
  if (!payload || typeof payload !== "object") return [];
  const rec = payload as { records?: unknown; reportRecords?: unknown };
  const raw = rec.records ?? rec.reportRecords;
  return Array.isArray(raw) ? (raw as Record<string, any>[]) : [];
}

function metric(metrics: unknown, name: string): number | null {
  if (!Array.isArray(metrics)) return null;
  for (const m of metrics) {
    if (!m || typeof m !== "object") continue;
    const rec = m as { metricType?: string; name?: string; value?: unknown };
    if (rec.metricType === name || rec.name === name) {
      const n = Number(rec.value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}
