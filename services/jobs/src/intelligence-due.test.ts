import { describe, expect, it } from "vitest";
import {
  formatIntelligenceDueReport,
  runIntelligenceDueReport,
  type Queryable,
} from "./intelligence-due.js";

function fakeDb(rows: unknown[]): Queryable & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async query(text: string) {
      sql.push(text);
      if (/prediction_needs_scoring/.test(text)) return { rows };
      return { rows: [{ db_now: new Date("2026-11-22T12:00:00Z") }] };
    },
  };
}

describe("intelligence-due report", () => {
  it("counts due predictions from the view and only ever reads", async () => {
    const db = fakeDb([
      { model_version: "manual", n: 2, oldest: new Date("2026-11-13T20:00:00Z"), db_now: new Date("2026-11-22T12:00:00Z") },
      { model_version: "sir-v1", n: 1, oldest: new Date("2026-11-20T00:00:00Z"), db_now: new Date("2026-11-22T12:00:00Z") },
    ]);
    const r = await runIntelligenceDueReport(db);
    expect(r).toMatchObject({
      source: "vault_core.prediction_needs_scoring",
      count: 3,
      oldestResolvesAt: "2026-11-13T20:00:00.000Z",
      byModelVersion: { manual: 2, "sir-v1": 1 },
    });
    expect(db.sql.every((q) => /^\s*SELECT/i.test(q))).toBe(true);
    expect(formatIntelligenceDueReport(r)).toMatch(/3 prediction\(s\).*nothing auto-resolves/);
  });

  it("reports an empty queue plainly", async () => {
    const r = await runIntelligenceDueReport(fakeDb([]));
    expect(r.count).toBe(0);
    expect(r.oldestResolvesAt).toBeNull();
    expect(formatIntelligenceDueReport(r)).toMatch(/no predictions waiting/);
  });
});
