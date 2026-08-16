import { markNormalized, markObserved } from "@vip/evidence";
import type { PriceHistoryAdapter, PriceObservation } from "@vip/pricing";
import { describe, expect, it } from "vitest";
import {
  formatPriceHistoryReport,
  normalizeDsn,
  parseArgs,
  runPriceHistoryJob,
} from "./price-history.js";

function obs(
  overrides: Partial<PriceObservation> & { observedOn: string },
): PriceObservation {
  return {
    externalId: "base1-4",
    productId: "42382",
    source: "tcgplayer.com",
    variant: "Holofoil",
    condition: "NM",
    conditionAssumed: false,
    currency: "USD",
    marketPrice: 100,
    lowSalePrice: null,
    highSalePrice: null,
    quantitySold: 0,
    transactionCount: 0,
    provenance: markNormalized({
      source: "tcgplayer.com",
      ruleOrModelVersion: "tcgplayer-price-history@0.1.0",
    }),
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("reads range, condition, cards, limit, concurrency and dry-run", () => {
    const opts = parseArgs([
      "--range=quarter",
      "--condition=lp",
      "--cards=base1-4, base1-58",
      "--limit=25",
      "--concurrency=2",
      "--dry-run",
    ]);
    expect(opts.range).toBe("quarter");
    expect(opts.condition).toBe("LP");
    expect(opts.cards).toEqual(["base1-4", "base1-58"]);
    expect(opts.limit).toBe(25);
    expect(opts.concurrency).toBe(2);
    expect(opts.dryRun).toBe(true);
  });

  it("defaults --backfill to the annual range", () => {
    expect(parseArgs(["--backfill"]).range).toBe("annual");
    expect(parseArgs(["--backfill=daily"]).range).toBe("daily");
  });

  it("ignores nonsense rather than guessing", () => {
    const opts = parseArgs(["--range=decade", "--limit=-4", "--concurrency=abc"]);
    expect(opts.range).toBeUndefined();
    expect(opts.limit).toBeUndefined();
    expect(opts.concurrency).toBeUndefined();
  });
});

describe("normalizeDsn", () => {
  it("converts a libpq keyword DSN to a URL", () => {
    expect(normalizeDsn("dbname=iqvault user=postgres password=vault host=localhost")).toBe(
      "postgresql://postgres:vault@localhost:5432/iqvault",
    );
  });

  it("passes a URL through untouched", () => {
    const url = "postgresql://postgres:vault@127.0.0.1:5432/iqvault";
    expect(normalizeDsn(url)).toBe(url);
  });
});

describe("runPriceHistoryJob (no database touched)", () => {
  function stubAdapter(observations: PriceObservation[]): PriceHistoryAdapter {
    return {
      id: "stub",
      label: "stub",
      matches: () => true,
      fetchHistory: async () => ({
        adapterId: "stub",
        externalId: "base1-4",
        observations,
      }),
    };
  }

  it("dry-run reports what it would write without opening a transaction", async () => {
    const report = await runPriceHistoryJob({
      cards: ["base1-4"],
      dryRun: true,
      adapter: stubAdapter([
        obs({ observedOn: "2026-08-16" }),
        obs({
          observedOn: "2026-08-15",
          transactionCount: 2,
          lowSalePrice: 900,
          highSalePrice: 950,
          provenance: markObserved({
            source: "tcgplayer.com",
            ruleOrModelVersion: "r",
            confidence: 0.85,
          }),
        }),
      ]),
      // Unreachable on purpose: a dry run must not need a live database.
      dsn: "postgresql://nobody@127.0.0.1:1/none",
    });

    expect(report.dryRun).toBe(true);
    expect(report.cardsPriced).toBe(1);
    expect(report.rowsWritten).toBe(0);
    expect(report.newestObservedOn).toBe("2026-08-16");
  });

  it("records an empty reason instead of failing silently", async () => {
    const report = await runPriceHistoryJob({
      cards: ["base1-4"],
      dryRun: true,
      adapter: {
        id: "stub",
        label: "stub",
        matches: () => true,
        fetchHistory: async () => ({
          adapterId: "stub",
          externalId: "base1-4",
          observations: [],
          emptyReason: "no TCGplayer product id for this card",
        }),
      },
      dsn: "postgresql://nobody@127.0.0.1:1/none",
    });
    expect(report.cardsEmpty).toBe(1);
    expect(report.emptyReasons[0]?.reason).toMatch(/product id/);
  });

  it("skips cards no adapter claims", async () => {
    const report = await runPriceHistoryJob({
      cards: ["hand-written"],
      dryRun: true,
      adapter: { ...stubAdapter([]), matches: () => false },
      dsn: "postgresql://nobody@127.0.0.1:1/none",
    });
    expect(report.cardsEmpty).toBe(1);
    expect(report.emptyReasons[0]?.reason).toMatch(/no adapter/);
  });
});

describe("formatPriceHistoryReport", () => {
  it("surfaces the newest observation date, not just counts", () => {
    const text = formatPriceHistoryReport({
      job: "price-history",
      ranAt: "2026-08-16T00:00:00.000Z",
      triggeredBy: "schedule",
      range: "daily",
      condition: "NM",
      dryRun: false,
      cardsConsidered: 2,
      cardsPriced: 2,
      cardsEmpty: 0,
      cardsFailed: 0,
      rowsWritten: 59,
      rowsUpdated: 1,
      slotsRefreshed: 3,
      newestObservedOn: "2026-08-16",
      emptyReasons: [],
    });
    expect(text).toContain("newest observation: 2026-08-16");
    expect(text).toContain("condition=NM");
  });
});
