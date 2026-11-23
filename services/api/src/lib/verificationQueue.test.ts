import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { comicsDsn, getDb } from "../db/client.js";
import { updateComicHolding } from "./comicsWrite.js";
import {
  VerificationQueueQuerySchema,
  VerificationQueueResponseSchema,
  candidateFromRow,
  guideRangeFromQuotes,
  loadVerificationQueue,
  rankVerificationQueue,
  type VerificationCandidate,
} from "./verificationQueue.js";

const NOW = new Date("2026-11-22T12:00:00Z");

function cand(id: string, over: Partial<VerificationCandidate> = {}): VerificationCandidate {
  return {
    id,
    title: id,
    publisher: null,
    isKeyIssue: false,
    keyReason: null,
    verificationNotes: null,
    importedAt: new Date("2026-07-04T00:00:00Z"),
    quotes: [],
    ...over,
  };
}

describe("guideRangeFromQuotes", () => {
  it("is a range over vendor guides with source count and recency, never a point", () => {
    const r = guideRangeFromQuotes(
      [
        { source: "covrprice", price: 40, observedOn: "2026-11-20" },
        { source: "comicbase", price: 25, observedOn: "2026-11-01" },
        { source: "clz", price: 30, observedOn: null },
      ],
      NOW,
    );
    expect(r).toMatchObject({
      low: 25,
      high: 40,
      sourceCount: 3,
      recencyDays: 2,
      evidenceClass: "vendor_guide",
      verificationStatus: "unverified",
    });
  });

  it("returns null with no usable quote rather than inventing a value", () => {
    expect(guideRangeFromQuotes([], NOW)).toBeNull();
  });
});

describe("rankVerificationQueue", () => {
  it("orders by guide high end, then key issue, then oldest import", () => {
    const ranked = rankVerificationQueue(
      [
        cand("cheap", { quotes: [{ source: "clz", price: 5, observedOn: null }] }),
        cand("none-old", { importedAt: new Date("2026-01-01T00:00:00Z") }),
        cand("none-key", { isKeyIssue: true }),
        cand("pricey", { quotes: [{ source: "covrprice", price: 300, observedOn: "2026-11-01" }] }),
        cand("tie-key", { isKeyIssue: true, quotes: [{ source: "clz", price: 5, observedOn: null }] }),
        cand("none-new"),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.id)).toEqual(["pricey", "tie-key", "cheap", "none-key", "none-old", "none-new"]);
    expect(ranked.map((r) => r.queuePosition)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ranked[4]?.guideRange).toBeNull();
  });
});

describe("candidateFromRow", () => {
  it("merges the three guide sources plus CLZ and reads the CLZ key flag", () => {
    const c = candidateFromRow({
      source_row_id: "h1",
      imported_at: "2026-07-04T00:00:00Z",
      series_title: "Amazing Spider-Man",
      issue_number: "300",
      cover_label: "Newsstand",
      covrprice_price: "410.00",
      covrprice_on: "2026-11-10",
      comicbase_price: null,
      pricecharting_price: "380",
      pricecharting_on: new Date("2026-11-01T00:00:00Z"),
      current_price_snapshot: "0",
      clz_key: "Major",
      is_key_issue: false,
    });
    expect(c.title).toBe("Amazing Spider-Man #300 Newsstand");
    expect(c.isKeyIssue).toBe(true);
    expect(c.quotes.map((q) => q.source)).toEqual(["covrprice", "pricecharting"]);
  });
});

describe("VerificationQueueQuerySchema", () => {
  it("clamps limit and defaults bad input", () => {
    expect(VerificationQueueQuerySchema.parse({ limit: "9999", offset: "x" })).toEqual({ limit: 200, offset: 0 });
    expect(VerificationQueueQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });
});

/**
 * Live Postgres: writes a few throwaway comics, clears one by the same PATCH
 * the UI uses, and checks the burn-down counter. Only runs against an explicitly
 * configured non-live database (never the default iqvault DSN).
 */
const dsn = comicsDsn();
const explicitTestDb =
  Boolean(process.env.IQVAULT_DATABASE_DSN ?? process.env.DATABASE_URL) && !/\/iqvault(\?|$)|dbname=iqvault\b/.test(dsn);

describe.skipIf(!explicitTestDb)("loadVerificationQueue (test Postgres)", () => {
  const tag = `vq-test-${randomUUID().slice(0, 8)}`;
  const assetIds: string[] = [];
  let seriesId: string | null = null;

  afterAll(async () => {
    const db = getDb();
    // Only rows this test created (tagged ids); the database is the test DB.
    if (assetIds.length) {
      await db.execute(sql`DELETE FROM vault_core.asset WHERE id = ANY(${`{${assetIds.join(",")}}`}::uuid[])`);
    }
    if (seriesId) await db.execute(sql`DELETE FROM vault_comic.series WHERE id = ${seriesId}::uuid`);
  });

  it("ranks unverified books by value and counts an operator click as verified this week", async () => {
    const db = getDb();
    const series = await db.execute(sql`
      INSERT INTO vault_comic.series (title, publisher) VALUES (${tag}, 'Test') RETURNING id
    `);
    seriesId = String((series.rows[0] as { id: string }).id);
    const books = [
      { n: "1", price: 500, key: false },
      { n: "2", price: 20, key: true },
      { n: "3", price: null, key: false },
    ];
    for (const b of books) {
      const asset = await db.execute(sql`
        INSERT INTO vault_core.asset (category_id, canonical_name) VALUES (4, ${`${tag} #${b.n}`}) RETURNING id
      `);
      const assetId = String((asset.rows[0] as { id: string }).id);
      assetIds.push(assetId);
      const issue = await db.execute(sql`
        INSERT INTO vault_comic.issue (series_id, issue_number, is_key_issue)
        VALUES (${seriesId}::uuid, ${b.n}, ${b.key}) RETURNING id
      `);
      await db.execute(sql`
        INSERT INTO vault_comic.variant (asset_id, issue_id)
        VALUES (${assetId}::uuid, ${String((issue.rows[0] as { id: string }).id)}::uuid)
      `);
      await db.execute(sql`
        INSERT INTO vault_collection.holding (asset_id, source, source_row_id, needs_verification, current_price_snapshot)
        VALUES (${assetId}::uuid, 'clz_import', ${`${tag}-${b.n}`}, TRUE, ${b.price})
      `);
    }

    const before = await loadVerificationQueue({ limit: 200, offset: 0 });
    expect(before.available).toBe(true);
    expect(VerificationQueueResponseSchema.safeParse(before).success).toBe(true);
    const ours = before.items.filter((i) => i.id.startsWith(tag)).map((i) => i.id);
    expect(ours).toEqual([`${tag}-1`, `${tag}-2`, `${tag}-3`]);

    const patched = await updateComicHolding(`${tag}-1`, { "Needs Verification": "No" });
    expect(patched.ok).toBe(true);
    const still = await updateComicHolding(`${tag}-2`, { "Needs Verification": "Yes" });
    expect(still.ok).toBe(true);

    const after = await loadVerificationQueue({ limit: 200, offset: 0 });
    expect(after.counts.needsVerification).toBe(before.counts.needsVerification - 1);
    expect(after.counts.verified).toBe(before.counts.verified + 1);
    expect(after.counts.verifiedThisWeek).toBe(before.counts.verifiedThisWeek + 1);
    const remaining = after.items.filter((i) => i.id.startsWith(tag)).map((i) => i.id);
    // "Still needs review" keeps the book in the queue; nothing auto-clears.
    expect(remaining).toEqual([`${tag}-2`, `${tag}-3`]);
  }, 30_000);
});

describe("GET /api/comics/verification-queue", () => {
  it("passes the parsed query to the loader and offers no bulk verify route", async () => {
    const { createApp } = await import("../app.js");
    let seen: { limit: number; offset: number } | null = null;
    const app = createApp({
      loadComics: async () => ({ available: false, holdings: [], snapshot: null, error: "fixture", dsn: "" }),
      loadScanHoldings: async () => [],
      loadVerificationQueue: async (q) => {
        seen = q;
        return VerificationQueueResponseSchema.parse({
          available: true,
          error: null,
          ruleOrModelVersion: "t",
          ordering: "t",
          note: "t",
          counts: { ownedTotal: 1, needsVerification: 1, verified: 0, verifiedThisWeek: 0, needsVerificationWithGuide: 0 },
          limit: q.limit,
          offset: q.offset,
          items: rankVerificationQueue([cand("a")], NOW),
        });
      },
    });
    const server = app.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    try {
      const base = `http://127.0.0.1:${addr.port}`;
      const res = await fetch(`${base}/api/comics/verification-queue?limit=10&offset=20`);
      expect(res.status).toBe(200);
      const body = VerificationQueueResponseSchema.parse(await res.json());
      expect(seen).toEqual({ limit: 10, offset: 20 });
      expect(body.items[0]?.id).toBe("a");
      const bulk = await fetch(`${base}/api/comics/verification-queue/verify-all`, { method: "POST" });
      expect(bulk.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
