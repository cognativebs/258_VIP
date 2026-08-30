import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { openScanFromApi } from "./scanIngest.js";
import {
  discardBatch,
  editStagedUnit,
  listStagedBatches,
  loadScanHoldings,
  persistBatch,
  rejectUnit,
  resolveUnit,
} from "./scanStorePg.js";

/**
 * ADR 0009 boundary, against live Postgres. Skips cleanly without a DB.
 *
 * The property under test is not "confirm works" but "nothing canonical exists
 * before confirm" — that is the rule the schema and pipeline must enforce.
 */

async function dbAvailable(): Promise<boolean> {
  try {
    await getDb().execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

function stageOneUnit(tag: string) {
  // Unique bytes per run so raw_snapshots dedupe does not collide across tests.
  return openScanFromApi({
    categoryHint: "sports",
    notes: `adr0009 test ${tag}`,
    pages: [
      {
        storageRef: `/tmp/adr9/${tag}_1986_topps_michael_jordan_57_front.jpg`,
        contentHash: `hash-front-${tag}`,
        fileName: `1986_topps_michael_jordan_57_front.jpg`,
        mimeType: "image/jpeg",
        face: "front",
        sequence: 0,
      },
      {
        storageRef: `/tmp/adr9/${tag}_1986_topps_michael_jordan_57_back.jpg`,
        contentHash: `hash-back-${tag}`,
        fileName: `1986_topps_michael_jordan_57_back.jpg`,
        mimeType: "image/jpeg",
        face: "back",
        sequence: 1,
      },
    ],
    inventory: [],
  });
}

async function countScanHoldings(): Promise<number> {
  const res = await getDb().execute(sql`
    SELECT count(*)::int AS n FROM vault_collection.holding WHERE source = 'ricoh_fi8170'
  `);
  return Number((res.rows as Array<{ n: number }>)[0]?.n ?? 0);
}

describe("scan staging (ADR 0009)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("stages candidates without writing anything canonical", async () => {
    if (!(await dbAvailable())) {
      console.warn("skipping ADR 0009 staging test: no Postgres");
      return;
    }

    const before = await countScanHoldings();
    const tag = randomUUID().slice(0, 8);
    const opened = stageOneUnit(tag);
    const staged = await persistBatch(opened);

    expect(staged.unitCount).toBe(1);
    expect(staged.candidateCount).toBeGreaterThan(0);

    // The whole point: identification happened, inventory did not move.
    expect(await countScanHoldings()).toBe(before);

    const db = getDb();
    const unresolved = await db.execute(sql`
      SELECT confirmed_asset_id, holding_id, resolution_mode, confidence_band
      FROM vault_media.scan_unit WHERE batch_id = ${staged.batchId}::uuid
    `);
    const unit = (unresolved.rows as Array<Record<string, unknown>>)[0]!;
    expect(unit.confirmed_asset_id).toBeNull();
    expect(unit.holding_id).toBeNull();
    expect(unit.resolution_mode).toBeNull();
    // Auto-resolve is off by default, so a strong match still waits for review.
    expect(unit.confidence_band).toBe("review");
  });

  it("survives a reload — staged batches come back from Postgres", async () => {
    if (!(await dbAvailable())) return;
    const tag = randomUUID().slice(0, 8);
    const staged = await persistBatch(stageOneUnit(tag));

    const batches = await listStagedBatches(50);
    const found = batches.find((b) => b.id === staged.batchId);
    expect(found).toBeTruthy();
    expect(found!.units.length).toBe(1);
    expect(
      (found!.units[0]!.candidates as Array<{ catalogKey: string }>).length,
    ).toBeGreaterThan(0);
  });

  it("crosses into inventory only on resolve, and is idempotent", async () => {
    if (!(await dbAvailable())) return;
    const tag = randomUUID().slice(0, 8);
    const opened = stageOneUnit(tag);
    const staged = await persistBatch(opened);
    const unitId = opened.batch.units[0]!.id;
    const catalogKey = opened.batch.units[0]!.candidates[0]!.catalogKey;

    const before = await countScanHoldings();

    const first = await resolveUnit({ unitId, catalogKey, mode: "operator_confirmed" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await countScanHoldings()).toBe(before + 1);

    const second = await resolveUnit({ unitId, catalogKey, mode: "operator_confirmed" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // A retry must not mint a second holding for the same physical card.
    expect(second.alreadyResolved).toBe(true);
    expect(second.holdingId).toBe(first.holdingId);
    expect(await countScanHoldings()).toBe(before + 1);

    const holdings = await loadScanHoldings();
    const mine = holdings.find((h) => h.id === first.holdingId);
    expect(mine?.needsVerification).toBe(true);
    expect(mine?.assumedGrade).toBe("NM");
    expect(mine?.inventoryBucket).toBe("dealer_inventory");
    expect(mine?.recommendation).toBe("Sell");

    void staged;
  });

  it("keeps a rejected unit's candidates and writes nothing canonical", async () => {
    if (!(await dbAvailable())) return;
    const tag = randomUUID().slice(0, 8);
    const opened = stageOneUnit(tag);
    await persistBatch(opened);
    const unitId = opened.batch.units[0]!.id;

    const before = await countScanHoldings();
    const rejected = await rejectUnit(unitId, "blurry scan");
    expect(rejected.ok).toBe(true);
    expect(await countScanHoldings()).toBe(before);

    const db = getDb();
    const res = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM vault_media.scan_unit_candidate WHERE unit_id = ${unitId}::uuid) AS candidates,
        (SELECT resolution_mode FROM vault_media.scan_unit WHERE id = ${unitId}::uuid) AS mode,
        (SELECT confirmed_asset_id FROM vault_media.scan_unit WHERE id = ${unitId}::uuid) AS asset
    `);
    const row = (res.rows as Array<Record<string, unknown>>)[0]!;
    // Candidates survive so a better catalog can re-run against the same capture.
    expect(Number(row.candidates)).toBeGreaterThan(0);
    expect(row.mode).toBe("rejected");
    expect(row.asset).toBeNull();
  });

  it("refuses to resolve a candidate that was never staged for the unit", async () => {
    if (!(await dbAvailable())) return;
    const tag = randomUUID().slice(0, 8);
    const opened = stageOneUnit(tag);
    await persistBatch(opened);
    const unitId = opened.batch.units[0]!.id;

    const result = await resolveUnit({
      unitId,
      catalogKey: "sports:not:a:staged:key",
      mode: "operator_confirmed",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CANDIDATE_NOT_FOUND");
  });

  it("lets the operator edit a staged card and then confirm a draft holding", async () => {
    if (!(await dbAvailable())) return;
    const tag = randomUUID().slice(0, 8);
    const opened = stageOneUnit(tag);
    await persistBatch(opened);
    const unitId = opened.batch.units[0]!.id;
    const before = await countScanHoldings();

    const edited = await editStagedUnit(unitId, {
      playerOrCharacter: "Kurtis Rourke",
      year: 2025,
      setName: "Panini Prizm",
      collectorNumber: "397",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.displayName).toMatch(/Rourke/);
    expect(await countScanHoldings()).toBe(before);

    const confirmed = await resolveUnit({
      unitId,
      catalogKey: edited.catalogKey,
      mode: "operator_confirmed",
    });
    expect(confirmed.ok).toBe(true);
    expect(await countScanHoldings()).toBe(before + 1);
  });

  it("hides a discarded batch from the queue without deleting holdings", async () => {
    if (!(await dbAvailable())) return;
    const tag = randomUUID().slice(0, 8);
    const opened = stageOneUnit(tag);
    const staged = await persistBatch(opened);
    const before = await countScanHoldings();

    const discarded = await discardBatch(staged.batchId);
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.rejected).toBe(1);
    expect(discarded.confirmedKept).toBe(0);
    expect(await countScanHoldings()).toBe(before);

    const listed = await listStagedBatches(50);
    expect(listed.some((b) => b.id === staged.batchId)).toBe(false);
  });
});
