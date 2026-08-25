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
  it("uses Comics API 200 as source=comics with unverified provenance", async () => {
    const bundle = await loadInventory(
      mockFetch({
        "/api/comics/meta": { status: 200, body: { snapshotLabel: "live", recordCount: 1, totalValue: 12 } },
        "/api/comics/inventory": { status: 200, body: [COMIC] },
      })
    );
    assert.equal(bundle.source, "comics");
    assert.equal(bundle.meta.recordCount, 1);
    assert.equal(bundle.meta.snapshotTotal.note, "catalog snapshot · unverified");
    assert.equal(bundle.provenance.verificationStatus, "unverified");
    assert.equal(bundle.provenance.method, "http_get");
    assert.equal(bundle.rows[0]?.id, "c1");
  });

  it("falls back to VIP when Comics returns 503", async () => {
    const bundle = await loadInventory(
      mockFetch({
        "/api/comics/meta": { status: 503, body: { error: "down" } },
        "/api/comics/inventory": { status: 503, body: { error: "down" } },
        "/api/vip/inventory": {
          status: 200,
          body: { count: 1, holdings: [{ id: "v1", series: "Batman", issue: "10" }] },
        },
      })
    );
    assert.equal(bundle.source, "vip");
    assert.equal(bundle.rows[0]?.Series, "Batman");
    assert.equal(bundle.provenance.source, "vip");
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

  it("treats malformed comics JSON as a failed source and ends unavailable if VIP also fails", async () => {
    const bundle = await loadInventory(
      mockFetch({
        "/api/comics/meta": { status: 200, body: { snapshotLabel: "x" } },
        "/api/comics/inventory": { status: 200, body: [{ nope: true }] },
        "/api/vip/inventory": { status: 200, body: { holdings: [{ id: "bad" }] } },
      })
    );
    assert.equal(bundle.source, "none");
    assert.equal(bundle.rows.length, 0);
  });
});
