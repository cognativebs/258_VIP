import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSellQueueLimit, SELL_QUEUE_MAX_LIMIT } from "./sellQueue.js";
import { DEFAULT_GRADING_COST_USD, loadGradingCostAssumption } from "./userConstraints.js";

describe("loadGradingCostAssumption", () => {
  const missing = join(tmpdir(), "vip-no-such-constraints.json");

  it("defaults to a labelled, unverified assumption", () => {
    const g = loadGradingCostAssumption({ VIP_USER_CONSTRAINTS_PATH: missing });
    expect(g.usd).toBe(DEFAULT_GRADING_COST_USD);
    expect(DEFAULT_GRADING_COST_USD).toBe(32);
    expect(g.source).toBe("default_assumption");
    expect(g.verificationStatus).toBe("unverified");
    expect(g.note).toMatch(/assumption/);
  });

  it("reads gradingCostUsd from user constraints", () => {
    const dir = mkdtempSync(join(tmpdir(), "vip-gc-"));
    const path = join(dir, "user-constraints.json");
    writeFileSync(path, JSON.stringify({ gradingCostUsd: 40 }));
    const g = loadGradingCostAssumption({ VIP_USER_CONSTRAINTS_PATH: path });
    expect(g).toMatchObject({ usd: 40, source: "user_constraints", verificationStatus: "unverified" });
  });

  it("env wins over the file and ignores junk", () => {
    expect(loadGradingCostAssumption({ VIP_GRADING_COST_USD: "18", VIP_USER_CONSTRAINTS_PATH: missing }).source).toBe(
      "env",
    );
    expect(
      loadGradingCostAssumption({ VIP_GRADING_COST_USD: "-3", VIP_USER_CONSTRAINTS_PATH: missing }).source,
    ).toBe("default_assumption");
  });
});

describe("parseSellQueueLimit", () => {
  it("defaults, floors and clamps", () => {
    expect(parseSellQueueLimit(undefined)).toBe(20);
    expect(parseSellQueueLimit("5.7")).toBe(5);
    expect(parseSellQueueLimit("0")).toBe(20);
    expect(parseSellQueueLimit("999")).toBe(SELL_QUEUE_MAX_LIMIT);
  });
});
