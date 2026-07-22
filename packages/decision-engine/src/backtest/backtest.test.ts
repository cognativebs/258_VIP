import { describe, expect, it } from "vitest";
import { formatBacktestReport, runBacktest } from "./harness.js";
import { HISTORICAL_DECISIONS } from "./fixture.js";

describe("Phase 2 gate — backtest harness", () => {
  it("loads 10 historical decisions and compares engine vs actual", () => {
    expect(HISTORICAL_DECISIONS).toHaveLength(10);
    const report = runBacktest();
    expect(report.total).toBe(10);

    for (const row of report.rows) {
      expect(row.supportingCount).toBeGreaterThanOrEqual(1);
      expect(row.opposingCount).toBeGreaterThanOrEqual(1);
      // Ranges only — never pretend a single point is enough
      expect(row.range === "insufficient" || row.range.includes("–")).toBe(true);
    }

    // Gate: agrees with good calls enough, and flags the known bad Buy (h07)
    const alignment = report.agree + report.softAgree;
    expect(alignment).toBeGreaterThanOrEqual(7);
    expect(report.flaggedBadCalls).toBeGreaterThanOrEqual(1);

    const bad = report.rows.find((r) => r.id === "h07");
    expect(bad?.flagsBadCall).toBe(true);
    expect(bad?.engineStance).not.toBe("Buy");

    // Readable report for dogfooding
    const text = formatBacktestReport(report);
    expect(text).toContain("VIP Decision Engine Backtest");
    // Uncomment locally: console.log(text);
  });
});
