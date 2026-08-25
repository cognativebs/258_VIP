import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadInventory } from "./inventoryApi";

const COMIC = { id: "c1", Series: "X-Men", "Issue Full": "1" };

function jsonRes(status: number, body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

function mockFetch(routes: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([path]) => url.includes(path));
    if (!hit) return jsonRes(404, { error: "missing" });
    return jsonRes(hit[1].status, hit[1].body);
  }) as typeof fetch;
}

describe("loadInventory", () => {
  it("prefers VIP when both VIP and Comics are up", async () => {
    const bundle = await loadInventory(
      mockFetch({
        "/api/vip/inventory": {
          status: 200,
          body: {
            count: 1,
            comicsAvailable: true,
            comicsCount: 1,
            comicsSnapshot: { shortHash: "aaaaaaaaaaaa", label: "CLZ" },
            holdings: [{ id: "v1", series: "Batman", issue: "10" }],
          },
        },
        "/api/comics/meta": { status: 200, body: { snapshotLabel: "live", recordCount: 1, totalValue: 12 } },
        "/api/comics/inventory": { status: 200, body: [COMIC] },
      })
    );
    assert.equal(bundle.source, "vip");
    assert.equal(bundle.rows[0]?.id, "v1");
    assert.match(bundle.meta.snapshotLabel, /VIP live inventory/);
    assert.equal(bundle.meta.snapshotTotal.note, "catalog snapshot · unverified");
    assert.equal(bundle.provenance.verificationStatus, "unverified");
  });

  it("falls back to Comics API when VIP is down", async () => {
    const bundle = await loadInventory(
      mockFetch({
        "/api/vip/inventory": { status: 503, body: { error: "down" } },
        "/api/comics/meta": { status: 200, body: { snapshotLabel: "live", recordCount: 1, totalValue: 12 } },
        "/api/comics/inventory": { status: 200, body: [COMIC] },
      })
    );
    assert.equal(bundle.source, "comics");
    assert.equal(bundle.meta.recordCount, 1);
    assert.equal(bundle.rows[0]?.id, "c1");
    assert.equal(bundle.provenance.method, "http_get");
  });

  it("returns source=none and does not throw when both fail", async () => {
    const bundle = await loadInventory(
      mockFetch({
        "/api/comics/meta": { status: 503, body: {} },
        "/api/comics/inventory": { status: 503, body: {} },
        "/api/vip/inventory": { status: 500, body: {} },
      })
    );
    assert.equal(bundle.source, "none");
    assert.equal(bundle.meta.recordCount, 0);
    assert.equal(bundle.provenance.method, "fallback_chain");
    assert.equal(bundle.provenance.verificationStatus, "unverified");
  });

  it("treats malformed VIP holdings as a failed source and ends unavailable if Comics also fails", async () => {
    const bundle = await loadInventory(
      mockFetch({
        "/api/vip/inventory": { status: 200, body: { holdings: [{ id: "bad" }] } },
        "/api/comics/meta": { status: 200, body: { snapshotLabel: "x" } },
        "/api/comics/inventory": { status: 200, body: [{ nope: true }] },
      })
    );
    assert.equal(bundle.source, "none");
    assert.equal(bundle.rows.length, 0);
  });
});
