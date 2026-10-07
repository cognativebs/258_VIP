import { describe, expect, it } from "vitest";
import { persistSignalsToVault } from "./signalsPersist.js";

function mockPool(opts: { conflict?: boolean; fail?: boolean }) {
  const calls: { sql: string; values: unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      if (opts.fail) throw new Error("relation vault_core.signals_raw does not exist");
      if (sql.includes("INSERT INTO vault_core.signals_raw")) {
        if (opts.conflict) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ id: "raw-1" }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
}

const sample = {
  id: "sig-1",
  sourceId: "pokemon-news-rss",
  signalType: "news" as const,
  title: "Reprint rumor",
  body: "A reprint rumor",
  signalDate: "2026-09-17T00:00:00.000Z",
  noveltyScore: 0.4,
  quarantineStatus: "active" as const,
  sourceUrl: null,
  ruleVersion: "signals@0.1.0",
};

describe("persistSignalsToVault", () => {
  it("inserts raw then normalized with inferred · unverified provenance", async () => {
    const pool = mockPool({});
    const report = await persistSignalsToVault(pool as never, [sample]);
    expect(report.insertedRaw).toBe(1);
    expect(report.normalized).toBe(1);
    expect(report.duplicates).toBe(0);
    expect(pool.calls[1]?.values).toContain("inferred");
    expect(pool.calls[1]?.sql).toMatch(/unverified/);
  });

  it("is idempotent when the payload hash already exists", async () => {
    const pool = mockPool({ conflict: true });
    const report = await persistSignalsToVault(pool as never, [sample]);
    expect(report.duplicates).toBe(1);
    expect(report.insertedRaw).toBe(0);
    expect(report.normalized).toBe(0);
    expect(pool.calls).toHaveLength(1);
  });

  it("records errors without throwing when the table is missing", async () => {
    const pool = mockPool({ fail: true });
    const report = await persistSignalsToVault(pool as never, [sample]);
    expect(report.errors[0]).toMatch(/does not exist/);
  });
});
