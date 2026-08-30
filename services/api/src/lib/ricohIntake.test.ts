import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/client.js";
import { writeRicohV1Fixture } from "./ricohFixture.js";
import {
  acceptanceRows,
  ingestRicohBatch,
  startUploadSession,
  writeUploadFile,
} from "./ricohIntake.js";

async function dbAvailable(): Promise<boolean> {
  try {
    await getDb().execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

describe("Ricoh trading-card scan intake v1", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("ingests 20 cards / 40 images with fusion, conflict, and physical reimport", async () => {
    if (!(await dbAvailable())) {
      console.warn("skipping Ricoh intake acceptance: no Postgres");
      return;
    }

    const folder = mkdtempSync(join(tmpdir(), "ricoh-v1-"));
    const masters = mkdtempSync(join(tmpdir(), "ricoh-masters-"));
    process.env.VIP_SCAN_MASTER_DIR = masters;
    delete process.env.VIP_SCAN_INBOX;
    delete process.env.VIP_SCAN_AUTO_RESOLVE;

    const written = writeRicohV1Fixture(folder, randomUUID().slice(0, 8));
    expect(written.imageCount).toBe(40);

    const result = await ingestRicohBatch({
      folder,
      categoryHint: "sports",
      pairing: "filename_front_back",
      source: "ricoh_fi8170",
      scannerProfile: "004_Cards",
      notes: "acceptance fixture",
    });

    expect(result.imageCount).toBe(40);
    expect(result.cards).toHaveLength(20);
    expect(result.source).toBe("ricoh_fi8170");
    expect(result.scannerProfile).toBe("004_Cards");
    expect(result.telemetry.imagesReceived).toBe(40);
    expect(result.telemetry.cardsPaired).toBeGreaterThanOrEqual(19);
    expect(result.telemetry.conflicts).toBeGreaterThanOrEqual(1);
    expect(result.telemetry.duplicateWarnings).toBeGreaterThanOrEqual(1);
    expect(result.telemetry.estimatedCostUsd).toBe(0);

    const conflict = result.cards.find((c) => c.reviewRoute === "CONFLICT");
    expect(conflict).toBeTruthy();
    expect(conflict!.evidence.fused.year.value).toBeNull();
    expect(conflict!.evidence.fused.playerOrCharacter.value).toBeNull();
    expect(conflict!.evidence.conflictNotes.length).toBeGreaterThan(0);

    const reimport = result.cards.filter((c) => c.physicalReimport);
    expect(reimport).toHaveLength(1);

    const landscape = result.cards.filter((c) => c.orientation === "landscape");
    expect(landscape.length).toBeGreaterThanOrEqual(2);

    const first = result.cards[0]!;
    expect(existsSync(first.originalFrontRef)).toBe(true);
    expect(existsSync(first.originalBackRef!)).toBe(true);
    expect(first.normalizedFrontRef).toBe(first.originalFrontRef);

    const silver = result.cards.find((c) =>
      (c.baseVsParallel.parallelDisplayName ?? "").toLowerCase().includes("silver"),
    );
    if (silver) {
      expect(silver.baseVsParallel.baseConfidence).toBeGreaterThan(
        silver.baseVsParallel.parallelConfidence,
      );
    }

    const report = acceptanceRows(result.cards);
    expect(report).toHaveLength(20);
    for (const row of report) {
      expect(row.pairing).toMatch(/ok|review/);
      expect(row.reviewStatus).toMatch(/HIGH|MEDIUM|LOW|CONFLICT/);
    }

    const holdingsBefore = await getDb().execute(sql`
      SELECT count(*)::int AS n FROM vault_collection.holding
      WHERE source = 'ricoh_fi8170'
    `);
    void holdingsBefore;
    // Default: no auto-resolve — draft candidates only.
    expect(result.cards.every((c) => c.reviewStatus !== "confirmed")).toBe(true);
  });

  it("writes one uploaded file at a time into a session folder", () => {
    const session = startUploadSession();
    const a = writeUploadFile(
      session.sessionId,
      "card_front.jpg",
      Buffer.from("front-bytes").toString("base64"),
    );
    const b = writeUploadFile(
      session.sessionId,
      "card_back.jpg",
      Buffer.from("back-bytes").toString("base64"),
    );
    expect(a.bytes).toBeGreaterThan(0);
    expect(b.bytes).toBeGreaterThan(0);
    expect(readFileSync(join(session.folder, "card_front.jpg"), "utf8")).toBe("front-bytes");
  });
});
