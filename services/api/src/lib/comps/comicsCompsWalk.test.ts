import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapInventoryRow } from "../holdings.js";
import { COMPS_HOLDING_CAP } from "../recommendations.js";
import { memoryListingObservationStore } from "./listingObservation.js";
import {
  parsePublishers,
  publisherMatches,
  runComicsCompsWalk,
  type WalkHolding,
} from "./comicsCompsWalk.js";
import type { CompsAdapterResult } from "./types.js";

function holding(id: string, publisher: string): WalkHolding {
  return {
    holdingUuid: randomUUID(),
    assetId: randomUUID(),
    holding: mapInventoryRow(
      {
        Series: id,
        "Issue Full": "1",
        Publisher: publisher,
        "CLZ Hash": id,
        Quantity: 1,
      },
      0,
    ),
  };
}

function browse(matched: number, extra?: Partial<CompsAdapterResult>): CompsAdapterResult {
  const sales = Array.from({ length: matched }, (_, i) => ({
    id: `ebay:${i}`,
    listingId: `item-${i}`,
    price: 3 + i,
    saleDate: new Date("2026-08-01T00:00:00.000Z"),
    source: "ebay.com/sold",
    provenance: {
      method: "api" as const,
      ruleOrModelVersion: "ebay-sold@0.1.0",
      verificationStatus: "unverified" as const,
      confidence: 0.5,
    },
  }));
  return {
    adapterId: "ebay-sold",
    sales,
    rawJson: JSON.stringify({ itemSummaries: sales }),
    emptyReason: matched ? undefined : "no eBay items matched",
    ...extra,
  };
}

describe("comicsCompsWalk", () => {
  it("defaults publishers to Marvel and DC", () => {
    expect(parsePublishers(undefined)).toEqual(["Marvel", "DC"]);
    expect(parsePublishers("all")).toEqual(["all"]);
    expect(publisherMatches("DC Comics", ["Marvel", "DC"])).toBe(true);
    expect(publisherMatches("Image", ["Marvel", "DC"])).toBe(false);
    expect(publisherMatches("Image", ["all"])).toBe(true);
  });

  it("walks a batch of 12, writes listings, and skips other publishers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vip-walk-"));
    const store = memoryListingObservationStore();
    const holdings = [
      ...Array.from({ length: 13 }, (_, i) => holding(`m-${String(i).padStart(2, "0")}`, "Marvel")),
      holding("image-1", "Image"),
    ];
    const result = await runComicsCompsWalk({
      publishers: ["Marvel", "DC"],
      cursorPath: join(dir, "cursor.json"),
      store,
      loadHoldings: async () => holdings,
      fetchHolding: async () => ({ adapters: [browse(2)] }),
      rateLimitMs: 0,
      maxHoldings: COMPS_HOLDING_CAP,
    });
    expect(result.cursor.processed).toBe(12);
    expect(result.stoppedReason).toBe("max-holdings");
    expect(store.observations.every((o) => o.holdingSourceRowId !== "image-1")).toBe(true);
    expect(store.observations.some((o) => o.observationKind === "browse_listing")).toBe(true);
    expect(store.sqlLog.join("\n")).not.toMatch(/vault_market\.sale|current_price_snapshot/);
  });

  it("resumes after the last cursor id and skips fresh rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vip-walk-"));
    const cursorPath = join(dir, "cursor.json");
    const store = memoryListingObservationStore();
    const holdings = [holding("a-1", "Marvel"), holding("b-2", "Marvel"), holding("c-3", "Marvel")];

    await runComicsCompsWalk({
      publishers: ["Marvel"],
      cursorPath,
      store,
      loadHoldings: async () => holdings,
      fetchHolding: async () => ({ adapters: [browse(1)] }),
      rateLimitMs: 0,
      maxHoldings: 1,
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });
    expect(resultLast(cursorPath)).toBe("a-1");

    const second = await runComicsCompsWalk({
      publishers: ["Marvel"],
      cursorPath,
      store,
      resume: true,
      loadHoldings: async () => holdings,
      fetchHolding: async () => ({ adapters: [browse(1)] }),
      rateLimitMs: 0,
      staleAfterHours: 24,
      now: () => new Date("2026-08-28T01:00:00.000Z"),
    });
    expect(second.cursor.lastHoldingSourceRowId).toBe("c-3");
    expect(second.stoppedReason).toBe("complete");

    const third = await runComicsCompsWalk({
      publishers: ["Marvel"],
      cursorPath,
      store,
      resume: false,
      loadHoldings: async () => holdings,
      fetchHolding: async () => ({ adapters: [browse(9)] }),
      rateLimitMs: 0,
      staleAfterHours: 24,
      now: () => new Date("2026-08-28T01:30:00.000Z"),
    });
    expect(third.cursor.skippedFresh).toBe(3);
    expect(store.observations.filter((o) => o.askPrice === 11)).toHaveLength(0);
  });

  it("stops on OAuth failure without inventing comps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vip-walk-"));
    const store = memoryListingObservationStore();
    const result = await runComicsCompsWalk({
      publishers: ["Marvel"],
      cursorPath: join(dir, "cursor.json"),
      store,
      loadHoldings: async () => [holding("z-1", "Marvel")],
      fetchHolding: async () => ({
        adapters: [browse(0, { emptyReason: "eBay OAuth HTTP 401 — invalid_client" })],
      }),
      rateLimitMs: 0,
    });
    expect(result.cursor.paused).toBe(true);
    expect(result.stoppedReason).toMatch(/401|invalid_client/);
    expect(store.observations).toHaveLength(0);
  });

  it("dry-run does not persist observations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vip-walk-"));
    const store = memoryListingObservationStore();
    await runComicsCompsWalk({
      publishers: ["DC"],
      cursorPath: join(dir, "cursor.json"),
      store,
      dryRun: true,
      loadHoldings: async () => [holding("d-1", "DC Comics")],
      fetchHolding: async () => ({ adapters: [browse(3)] }),
      rateLimitMs: 0,
    });
    expect(store.observations).toHaveLength(0);
    expect(store.snapshots).toHaveLength(0);
  });
});

function resultLast(path: string): string | null {
  const cursor = JSON.parse(readFileSync(path, "utf8")) as { lastHoldingSourceRowId: string | null };
  return cursor.lastHoldingSourceRowId;
}
