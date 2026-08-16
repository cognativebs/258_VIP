import { markNormalized, markObserved } from "@vip/evidence";
import { describe, expect, it } from "vitest";
import {
  listBinderCards,
  pickNewest,
  shouldRefreshSlots,
  syncPriceHistory,
  type SqlRunner,
} from "./sync.js";
import type { PriceHistoryAdapter, PriceObservation } from "./types.js";

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

/** Records every statement so SQL-level guards can be asserted without a DB. */
function recordingRunner(
  rows: Array<Record<string, unknown>> = [],
): { runner: SqlRunner; calls: Array<{ text: string; params: unknown[] }> } {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const runner: SqlRunner = async (text, params = []) => {
    calls.push({ text, params: params as unknown[] });
    if (/SELECT DISTINCT/i.test(text)) return { rows, rowCount: rows.length };
    if (/INSERT INTO vault_market\.card_price_history/i.test(text)) {
      return { rows: [{ inserted: true }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };
  return { runner, calls };
}

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

describe("listBinderCards", () => {
  it("de-duplicates cards and can scope to one binder", async () => {
    const { runner, calls } = recordingRunner([
      { source: "pokemontcg", external_id: "base1-4" },
    ]);
    await listBinderCards(runner, { binderId: "b-1", limit: 10 });
    const sql = calls[0]!.text;
    // The same card in two binders must cost one lookup, not two.
    expect(sql).toMatch(/SELECT DISTINCT/i);
    expect(sql).toMatch(/JOIN vault_tcg\.binder_page/i);
    expect(sql).toMatch(/LIMIT \$2/);
    expect(calls[0]!.params).toEqual(["b-1", 10]);
  });

  it("omits the join when no binder is given", async () => {
    const { runner, calls } = recordingRunner();
    await listBinderCards(runner, {});
    expect(calls[0]!.text).not.toMatch(/JOIN/i);
    expect(calls[0]!.params).toEqual([]);
  });
});

describe("pickNewest", () => {
  it("takes the latest day for the requested condition", () => {
    expect(
      pickNewest(
        [obs({ observedOn: "2026-08-10" }), obs({ observedOn: "2026-08-16" })],
        "NM",
      )?.observedOn,
    ).toBe("2026-08-16");
  });

  it("ignores other conditions when the wanted one exists", () => {
    const newest = pickNewest(
      [
        obs({ observedOn: "2026-08-16", condition: "LP", marketPrice: 509 }),
        obs({ observedOn: "2026-08-15", condition: "NM", marketPrice: 852 }),
      ],
      "NM",
    );
    expect(newest?.marketPrice).toBe(852);
  });
});

describe("shouldRefreshSlots", () => {
  it("only lets NM define the binder's displayed value", () => {
    // Regression: a condition=LP run once overwrote a $852 NM slot with $509.
    expect(shouldRefreshSlots("NM")).toBe(true);
    for (const c of ["LP", "MP", "HP", "DMG", "UNKNOWN"] as const) {
      expect(shouldRefreshSlots(c)).toBe(false);
    }
  });
});

describe("syncPriceHistory", () => {
  it("writes history and refreshes slots for an NM run", async () => {
    const { runner, calls } = recordingRunner();
    const report = await syncPriceHistory({
      runner,
      cards: ["base1-4"],
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
    });

    expect(report.cardsPriced).toBe(1);
    expect(report.rowsWritten).toBe(2);
    expect(report.newestObservedOn).toBe("2026-08-16");
    expect(report.slotsRefreshed).toBe(1);

    const update = calls.find((c) => /UPDATE vault_tcg\.binder_slot/i.test(c.text));
    expect(update).toBeTruthy();
    // Never move freshness backwards: an annual backfill's newest bucket is a
    // week old and would otherwise make a fresh slot look stale.
    expect(update!.text).toMatch(/price_updated_at IS NULL OR price_updated_at <= \$3/);
  });

  it("records history but leaves the slot alone for a non-NM run", async () => {
    const { runner, calls } = recordingRunner();
    const report = await syncPriceHistory({
      runner,
      cards: ["base1-4"],
      condition: "LP",
      adapter: stubAdapter([obs({ observedOn: "2026-08-16", condition: "LP" })]),
    });
    expect(report.rowsWritten).toBe(1);
    expect(report.slotsRefreshed).toBe(0);
    expect(calls.some((c) => /UPDATE vault_tcg\.binder_slot/i.test(c.text))).toBe(false);
  });

  it("upserts on the daily constraint so a same-day re-run cannot duplicate", async () => {
    const { runner, calls } = recordingRunner();
    await syncPriceHistory({
      runner,
      cards: ["base1-4"],
      adapter: stubAdapter([obs({ observedOn: "2026-08-16" })]),
    });
    const insert = calls.find((c) => /INSERT INTO vault_market\.card_price_history/i.test(c.text));
    expect(insert!.text).toMatch(/ON CONFLICT ON CONSTRAINT card_price_history_daily_unique/);
    expect(insert!.text).toMatch(/DO UPDATE SET/);
  });

  it("dry-run touches nothing", async () => {
    const { runner, calls } = recordingRunner();
    const report = await syncPriceHistory({
      runner,
      cards: ["base1-4"],
      dryRun: true,
      adapter: stubAdapter([obs({ observedOn: "2026-08-16" })]),
    });
    expect(report.cardsPriced).toBe(1);
    expect(report.rowsWritten).toBe(0);
    expect(calls.filter((c) => /INSERT|UPDATE/i.test(c.text))).toHaveLength(0);
  });

  it("reports an empty reason rather than failing silently", async () => {
    const { runner } = recordingRunner();
    const report = await syncPriceHistory({
      runner,
      cards: ["base1-4"],
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
    });
    expect(report.cardsEmpty).toBe(1);
    expect(report.emptyReasons[0]?.reason).toMatch(/product id/);
  });

  it("counts a card no adapter claims instead of pricing it", async () => {
    const { runner } = recordingRunner();
    const report = await syncPriceHistory({
      runner,
      cards: ["hand-written"],
      adapter: { ...stubAdapter([]), matches: () => false },
    });
    expect(report.cardsEmpty).toBe(1);
    expect(report.emptyReasons[0]?.reason).toMatch(/no adapter/);
  });

  it("survives one card failing", async () => {
    const { runner } = recordingRunner();
    const report = await syncPriceHistory({
      runner,
      cards: ["base1-4"],
      adapter: {
        id: "stub",
        label: "stub",
        matches: () => true,
        fetchHistory: async () => {
          throw new Error("provider exploded");
        },
      },
    });
    expect(report.cardsFailed).toBe(1);
    expect(report.emptyReasons[0]?.reason).toMatch(/exploded/);
  });
});
