import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import {
  IntelligenceImportReportSchema,
  createPrediction,
  seedIntelligenceFixtures,
} from "@vip/intelligence";
import { createApp } from "../app.js";
import { normalizeDsn } from "../db/client.js";
import { emptyIntelligenceDoc, type IntelligenceStore } from "./intelligenceStore.js";
import {
  importIntelligenceDoc,
  insertPrediction,
  isPgUnavailable,
  pgIntelligenceStore,
} from "./intelligenceStorePg.js";
import {
  IntelligenceStoreUnavailableError,
  createIntelligenceStoreSelector,
} from "./intelligenceStoreSelect.js";

const DSN = process.env.IQVAULT_TEST_DSN;

/**
 * Everything runs inside one transaction that is rolled back: prediction rows
 * can never be deleted (trg_prediction_protect_forecast), so a committed test
 * row would stay in the database forever.
 */
async function inTransaction(
  fn: (ctx: { db: PoolClient; store: IntelligenceStore; assetId: string; holdingId: string }) => Promise<void>,
) {
  const pool = new Pool({ connectionString: normalizeDsn(DSN!) });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const asset = await db.query(
      `INSERT INTO vault_core.asset (category_id, canonical_name)
       VALUES ((SELECT id FROM vault_core.categories WHERE kind = 'pokemon'), 'intel-store test asset (rolled back)')
       RETURNING id::text AS id`,
    );
    const assetId = asset.rows[0].id as string;
    const holding = await db.query(
      `INSERT INTO vault_collection.holding (asset_id) VALUES ($1::uuid) RETURNING id::text AS id`,
      [assetId],
    );
    const holdingId = holding.rows[0].id as string;
    const store = pgIntelligenceStore(db, { inTransaction: true });
    await fn({ db, store, assetId, holdingId });
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

const P = { priceAtPrediction: 230, horizonDays: 90, probabilityDown: 0.55, probabilitySideways: 0.3, probabilityUp: 0.15 };

describe.skipIf(!DSN)("Postgres intelligence store (IQVAULT_TEST_DSN, rolled back)", () => {
  it("writes a prediction to vault_core.prediction and refuses an asset that is not in the catalog", async () => {
    await inTransaction(async ({ store, assetId, db }) => {
      await expect(store.addPrediction({ assetId: "zz-no-such-asset-slug", ...P })).rejects.toThrow(
        /matches no asset/,
      );
      const p = await store.addPrediction({ assetId, ...P, assumptions: "pg test" });
      expect(p.assetId).toBe(assetId);
      expect(Math.round((p.resolvesAt.getTime() - p.predictedAt.getTime()) / 86_400_000)).toBe(90);
      expect(p.provenance.method).toBe("inferred");
      expect(p.provenance.verificationStatus).toBe("unverified");
      // Q21: provenance is stored at write time, so it is not rebuilt.
      expect(p.provenance.notes ?? "").not.toMatch(/rebuilt on read/);
      const provRow = await db.query(
        `SELECT prov_method, prov_rule_version, prov_verification_status FROM vault_core.prediction WHERE id = $1`,
        [p.id],
      );
      expect(provRow.rows[0]).toMatchObject({ prov_method: "inferred", prov_verification_status: "unverified" });
      expect(provRow.rows[0].prov_rule_version).toBe(p.provenance.ruleOrModelVersion);
      const row = await db.query(`SELECT resolves_at FROM vault_core.prediction WHERE id = $1`, [p.id]);
      expect(new Date(row.rows[0].resolves_at).getTime()).toBe(p.resolvesAt.getTime());
      // Early resolution is refused by the domain rule before any UPDATE.
      await expect(store.resolvePrediction(p.id, 180)).rejects.toThrow(/resolvesAt/);
      const doc = await store.load();
      expect(doc.predictions.map((x) => x.id)).toContain(p.id);
    });
  });

  it("reads due predictions from prediction_needs_scoring and a person resolves them once", async () => {
    await inTransaction(async ({ store, assetId, db }) => {
      const before = (await store.duePredictions()).count;
      const old = createPrediction({
        assetId,
        predictedAt: new Date(Date.now() - 100 * 86_400_000),
        ...P,
        horizonDays: 30,
        modelVersion: "manual",
      });
      expect(await insertPrediction(db, old)).toBe(true);
      expect(await insertPrediction(db, old)).toBe(false); // idempotent on id

      const due = await store.duePredictions();
      expect(due).toMatchObject({ store: "postgres", source: "vault_core.prediction_needs_scoring" });
      expect(due.count).toBe(before + 1);
      expect(due.predictions.map((x) => x.id)).toContain(old.id);

      const resolved = await store.resolvePrediction(old.id, 150, { explanation: "sold comps, checked by hand" });
      expect(resolved).toMatchObject({ actualPrice: 150, actualDirection: "down", forecastError: -80 });
      expect(resolved.provenance.method).toBe("observed");
      expect((await store.duePredictions()).count).toBe(before);

      await expect(store.resolvePrediction(old.id, 160)).rejects.toThrow(/never mutated again/);

      // The forecast-protect trigger still guards the table directly.
      await db.query("SAVEPOINT t");
      await expect(
        db.query(`UPDATE vault_core.prediction SET price_at_prediction = 1 WHERE id = $1`, [old.id]),
      ).rejects.toThrow(/immutable/);
      await db.query("ROLLBACK TO SAVEPOINT t");
    });
  });

  it("finds an asset by slug, exact name or external id, and refuses an ambiguous key (Q18)", async () => {
    await inTransaction(async ({ store, assetId, holdingId, db }) => {
      const slug = `zz-intel-slug-${randomUUID().slice(0, 8)}`;
      await db.query(`UPDATE vault_core.asset SET slug = $2 WHERE id = $1::uuid`, [assetId, slug]);
      expect((await store.addPrediction({ assetId: slug, ...P })).assetId).toBe(assetId);
      expect((await store.addPrediction({ assetId: "INTEL-STORE TEST ASSET (ROLLED BACK)", ...P })).assetId).toBe(assetId);
      const ext = `zz-ext-${randomUUID().slice(0, 8)}`;
      await db.query(
        `INSERT INTO vault_core.external_id (asset_id, source, external_value) VALUES ($1::uuid, 'test', $2)`,
        [assetId, ext],
      );
      expect((await store.addPrediction({ assetId: ext, ...P })).assetId).toBe(assetId);
      // A holding by asset key works while the asset has exactly one holding.
      const g = await store.addGrading({ holdingId: slug, rawValue: 80, gradingCost: 32 });
      expect(g.holdingId).toBe(holdingId);

      await db.query(
        `INSERT INTO vault_core.asset (category_id, canonical_name)
         VALUES ((SELECT id FROM vault_core.categories WHERE kind = 'pokemon'), 'intel-store test asset (rolled back)')`,
      );
      await expect(
        store.addPrediction({ assetId: "intel-store test asset (rolled back)", ...P }),
      ).rejects.toThrow(/matches 2 assets/);
      await db.query(`INSERT INTO vault_collection.holding (asset_id) VALUES ($1::uuid)`, [assetId]);
      await expect(store.addGrading({ holdingId: slug, rawValue: 80, gradingCost: 32 })).rejects.toThrow(
        /several holdings/,
      );
    });
  });

  it("labels a row written before stored provenance as rebuilt on read (Q21)", async () => {
    await inTransaction(async ({ store, db }) => {
      const u = await store.addUnderwriting({ lotDescription: "old row", askingPrice: 100, offerPrice: 90, conservativeRawValue: 150 });
      await db.query(
        `UPDATE vault_core.acquisition_underwriting
            SET prov_source = NULL, prov_method = NULL, prov_rule_version = NULL,
                prov_confidence = NULL, prov_verification_status = NULL, prov_notes = NULL
          WHERE id = $1`,
        [u.id],
      );
      const doc = await store.load();
      const old = doc.underwriting.find((x) => x.id === u.id);
      expect(old?.provenance.notes).toMatch(/rebuilt on read/);
      expect(old?.provenance.method).toBe("inferred");
    });
  });

  it("underwrites, locks once, and keeps coverage/below-threshold from the SQL view", async () => {
    await inTransaction(async ({ store }) => {
      const u = await store.addUnderwriting({ lotDescription: "pg lot", askingPrice: 750, offerPrice: 700, conservativeRawValue: 770 });
      expect(u.acquisitionCoverageRatio).toBe(1.1);
      expect(u.belowThreshold).toBe(true);
      expect(u.blocked).toBe(false);
      expect(u.provenance.notes ?? "").not.toMatch(/rebuilt on read/);
      const locked = await store.lockUnderwriting(u.id);
      expect(locked.completedTransaction).toBe(true);
      expect(locked.lockedAt).toBeInstanceOf(Date);
      await expect(store.lockUnderwriting(u.id)).rejects.toThrow(/immutable/i);
    });
  });

  it("grades a real holding only", async () => {
    await inTransaction(async ({ store, holdingId }) => {
      await expect(store.addGrading({ holdingId: "zz-no-such-holding", rawValue: 80, gradingCost: 25 })).rejects.toThrow(
        /matches no asset/,
      );
      const g = await store.addGrading({
        holdingId,
        rawValue: 80,
        gradingCost: 25,
        psa9: { probability: 0.5, value: 180 },
        psa10: { probability: 0.25, value: 400 },
      });
      expect(g.holdingId).toBe(holdingId);
      expect(g.expectedGradingValue).toBe(190);
      expect(g.provenance.method).toBe("inferred");
    });
  });

  it("keeps cycle rows manual, and links a field capture to its scan, identification and underwriting", async () => {
    await inTransaction(async ({ store, assetId, db }) => {
      const { cycle, scan } = await store.addManualCycle({ assetId, cycleState: "accumulation", watchNote: "watch" });
      expect(cycle.dataSource).toBe("manual");
      expect(scan.marketCycleStateId).toBe(cycle.id);

      const session = await store.startFieldSession({ mode: "store", locationContext: "LGS" });
      await expect(store.captureFieldItem({ sessionId: "nope" })).rejects.toThrow(/Field session not found/);
      const capture = await store.captureFieldItem({
        sessionId: session.id,
        imageRef: "s3://scans/pg-test.jpg",
        askingPrice: 40,
        conservativeRawValue: 60,
      });
      expect(capture.needsReview).toBe(true);
      expect(capture.imageRef).toBe("s3://scans/pg-test.jpg");
      expect(capture.cardScanId).not.toBeNull();
      expect(capture.identificationId).not.toBeNull();
      expect(capture.underwritingId).not.toBeNull();
      // Q20: the link is a column, not a tag in the underwriting notes.
      const link = await db.query(
        `SELECT c.acquisition_underwriting_id, au.notes
           FROM vault_core.field_captured_item c
           JOIN vault_core.acquisition_underwriting au ON au.id = c.acquisition_underwriting_id
          WHERE c.id = $1`,
        [capture.id],
      );
      expect(link.rows[0].acquisition_underwriting_id).toBe(capture.underwritingId);
      expect(String(link.rows[0].notes ?? "")).not.toMatch(/field_capture:/);

      const golden = await store.addGoldenCase({ imageRef: "s3://golden/pg.jpg", knownCorrectAssetId: assetId });
      const doc = await store.load();
      expect(doc.captures.find((c) => c.id === capture.id)?.underwritingId).toBe(capture.underwritingId);
      expect(doc.goldenCases.map((g) => g.id)).toContain(golden.id);
      expect(doc.identifications.find((i) => i.id === capture.identificationId)?.needsReview).toBe(true);
    });
  });

  it("imports a JSON state file idempotently, skipping rows whose catalog rows are missing", async () => {
    await inTransaction(async ({ db, assetId, holdingId }) => {
      const fx = seedIntelligenceFixtures();
      const mine = createPrediction({ assetId, predictedAt: new Date("2026-08-01T00:00:00Z"), ...P, horizonDays: 30 });
      const doc = {
        ...emptyIntelligenceDoc(),
        predictions: [fx.megaGreninja, mine],
        recommendations: [fx.crownZenith],
        // Fresh id: the fixture id may already be in a shared test database.
        underwriting: [{ ...fx.vintageLot, id: randomUUID() }],
        grading: [{ ...fx.grading.flareon, holdingId }, fx.grading.jolteon],
        cycleStates: [fx.drewBreesCycle],
        buyScans: [fx.drewBreesWatch],
      };
      const dry = IntelligenceImportReportSchema.parse(
        await importIntelligenceDoc(db, doc, { dryRun: true, source: "test", inTransaction: true }),
      );
      expect(dry.collections.predictions).toMatchObject({ inJson: 2, inserted: 1, alreadyPresent: 0 });
      expect(dry.collections.predictions!.skipped[0]!.reason).toMatch(/not in vault_core\.asset/);
      expect(dry.collections.underwriting).toMatchObject({ inserted: 1 });
      expect(dry.collections.grading).toMatchObject({ inserted: 1 });
      expect(dry.collections.recommendations!.skipped).toHaveLength(1);
      const afterDry = await db.query(`SELECT count(*)::int AS n FROM vault_core.prediction WHERE id = $1`, [mine.id]);
      expect(afterDry.rows[0].n).toBe(0); // dry run rolled back

      const first = await importIntelligenceDoc(db, doc, { dryRun: false, source: "test", inTransaction: true });
      expect(first.totals.inserted).toBe(dry.totals.inserted);
      const second = await importIntelligenceDoc(db, doc, { dryRun: false, source: "test", inTransaction: true });
      expect(second.totals.inserted).toBe(0);
      expect(second.totals.alreadyPresent).toBe(first.totals.inserted);

      const store = pgIntelligenceStore(db, { inTransaction: true });
      const loaded = await store.load();
      const p = loaded.predictions.find((x) => x.id === mine.id)!;
      expect(p.predictedAt.toISOString()).toBe(mine.predictedAt.toISOString());
      expect(p.resolvesAt.toISOString()).toBe(mine.resolvesAt.toISOString());
    });
  });

  it("serves the resolve route from Postgres", async () => {
    await inTransaction(async ({ db, store, assetId }) => {
      const old = createPrediction({ assetId, predictedAt: new Date(Date.now() - 40 * 86_400_000), ...P, horizonDays: 30 });
      await insertPrediction(db, old);
      const app = createApp({
        loadComics: async () => ({ available: false, holdings: [], snapshot: null, error: "test", dsn: "test" }),
        loadScanHoldings: async () => [],
        intelligenceStore: createIntelligenceStoreSelector({ mode: "postgres", pg: () => store }),
      });
      const server = app.listen(0);
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      const base = `http://127.0.0.1:${addr.port}`;
      try {
        const due = (await (await fetch(`${base}/api/intelligence/predictions/due`)).json()) as {
          store: string;
          predictions: { id: string }[];
        };
        expect(due.store).toBe("postgres");
        expect(due.predictions.map((x) => x.id)).toContain(old.id);

        const res = await fetch(`${base}/api/intelligence/predictions/${old.id}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actualPrice: 240, explanation: "route test" }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { store: string; prediction: { actualDirection: string } };
        expect(body).toMatchObject({ store: "postgres", prediction: { actualDirection: "sideways" } });

        const again = await fetch(`${base}/api/intelligence/predictions/${old.id}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actualPrice: 1 }),
        });
        expect(again.status).toBe(400);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});

describe("intelligence store selection", () => {
  const fake = (kind: "postgres" | "json", err?: unknown): IntelligenceStore =>
    ({
      kind,
      load: async () => {
        if (err) throw err;
        return emptyIntelligenceDoc();
      },
    }) as unknown as IntelligenceStore;

  it("falls back to JSON only when Postgres is unreachable, and says so", async () => {
    const down = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433"), { code: "ECONNREFUSED" });
    expect(isPgUnavailable(down)).toBe(true);
    const sel = createIntelligenceStoreSelector({ mode: "auto", pg: () => fake("postgres", down), json: () => fake("json") });
    const out = await sel.run((s) => s.load());
    expect(out.store).toBe("json");
    expect(out.fallbackReason).toMatch(/ECONNREFUSED/);
  });

  it("does not fall back on a guardrail rejection", async () => {
    const trigger = Object.assign(new Error("resolved predictions are immutable"), { code: "P0001" });
    expect(isPgUnavailable(trigger)).toBe(false);
    const sel = createIntelligenceStoreSelector({ mode: "auto", pg: () => fake("postgres", trigger), json: () => fake("json") });
    await expect(sel.run((s) => s.load())).rejects.toThrow(/immutable/);
  });

  it("postgres mode never silently uses JSON", async () => {
    const down = Object.assign(new Error("db down"), { code: "57P03" });
    const sel = createIntelligenceStoreSelector({ mode: "postgres", pg: () => fake("postgres", down), json: () => fake("json") });
    await expect(sel.run((s) => s.load())).rejects.toBeInstanceOf(IntelligenceStoreUnavailableError);
  });
});
