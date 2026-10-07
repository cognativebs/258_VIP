import { describe, expect, it } from "vitest";
import { formatClzDiffReport, type ClzDiffJobResult } from "./clz-diff.js";

describe("clz-diff job", () => {
  it("reports a dry-run and waits to apply", () => {
    const result: ClzDiffJobResult = {
      job: "clz-diff",
      ranAt: "2026-09-20T23:00:00.000Z",
      watch: "data/imports/clz",
      empty: false,
      phase2Enabled: false,
      report: {
        dryRun: true,
        applied: false,
        newCount: 1,
        changedCount: 2,
        unchangedCount: 2697,
        disappearedCount: 3,
        possiblySoldFlagged: 0,
        byType: {
          ownershipNew: 1,
          ownershipSold: 3,
          ownershipQuantity: 0,
          conditionGrade: 1,
          clzValueDrift: 1,
          metadataOnly: 0,
        },
        newNeedFreshVendorMap: 1,
        snapshotPath: "data/raw/clz/2026-09-20_abc.xml",
        reportPath: "data/imports/clz/reports/2026-09-20_abc_diff.json",
      },
    };
    const text = formatClzDiffReport(result);
    expect(text).toMatch(/dryRun=true/);
    expect(text).toMatch(/ownership new=1 sold=3/);
    expect(text).toMatch(/clzValueDrift=1/);
    expect(text).toMatch(/waiting for confirmation/);
    expect(text).not.toMatch(/signals_normalized/);
  });
});
