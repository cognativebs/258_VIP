import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { markInferred } from "@vip/evidence";
import { mapInventoryRow } from "../holdings.js";
import { memoryListingObservationStore } from "./listingObservation.js";
import { runComicsGuideSnapshot } from "./comicsGuideSnapshot.js";
import {
  chicagoSnapshotOn,
  guideRowsFromLiveObservations,
  memoryGuideSnapshotStore,
} from "./guideSnapshot.js";
import type { ListingObservation } from "./listingObservation.js";

function liveObs(kind: "guide_quote" | "guide_empty", price: number | null): ListingObservation {
  const now = new Date("2026-09-14T08:00:00.000Z");
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    provenance: markInferred({
      source: "pricecharting",
      ruleOrModelVersion: "pricecharting-guide@0.1.0",
    }),
    assetId: randomUUID(),
    holdingId: randomUUID(),
    holdingSourceRowId: "row-1",
    conditionKey: "any",
    observationKind: kind,
    source: "pricecharting",
    listingId: kind === "guide_quote" ? "pc:1:loose" : "empty:row-1",
    askPrice: price,
    currency: "USD",
    observedAt: now,
    providerIds: { pricecharting_id: "1" },
  };
}

describe("guideRowsFromLiveObservations", () => {
  it("stores one vendor_derived loose quote for the Chicago day", () => {
    const observedAt = new Date("2026-09-14T08:00:00.000Z");
    const rows = guideRowsFromLiveObservations({
      assetId: randomUUID(),
      holdingId: randomUUID(),
      holdingSourceRowId: "row-1",
      observations: [liveObs("guide_quote", 9.5)],
      observedAt,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.snapshotOn).toBe(chicagoSnapshotOn(observedAt));
    expect(rows[0]?.conditionKey).toBe("raw_ungraded");
    expect(rows[0]?.evidenceClass).toBe("vendor_derived");
    expect(rows[0]?.guidePrice).toBe(9.5);
  });
});

describe("runComicsGuideSnapshot", () => {
  it("writes today's history once and skips a second run the same Chicago day", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vip-guide-"));
    const listingStore = memoryListingObservationStore();
    const guideStore = memoryGuideSnapshotStore();
    const holding = {
      holdingUuid: randomUUID(),
      assetId: randomUUID(),
      holding: mapInventoryRow(
        {
          Series: "Action Comics",
          "Issue Full": "1",
          Publisher: "DC Comics",
          "CLZ Hash": "ac-1",
          Quantity: 1,
        },
        0,
      ),
    };
    const fetchHolding = async () => ({
      adapters: [
        {
          adapterId: "pricecharting",
          sales: [
            {
              id: "pc:1:loose",
              listingId: "pc:1:loose",
              price: 4.25,
              saleDate: new Date("2026-09-14T08:00:00.000Z"),
              source: "pricecharting.com/guide",
              provenance: {
                method: "api" as const,
                ruleOrModelVersion: "pricecharting-guide@0.1.0",
                verificationStatus: "unverified" as const,
                confidence: 0.6,
              },
            },
          ],
          rawJson: "{}",
        },
      ],
    });
    const loadHoldings = async () => [holding];
    const now = () => new Date("2026-09-14T08:00:00.000Z");

    const first = await runComicsGuideSnapshot({
      cursorPath: join(dir, "cursor.json"),
      listingStore,
      guideStore,
      now,
      loadHoldings,
      fetchHolding,
      rateLimitMs: 0,
    });
    expect(first.cursor.processed).toBe(1);
    expect(guideStore.rows).toHaveLength(1);
    expect(guideStore.rows[0]?.guidePrice).toBe(4.25);

    const second = await runComicsGuideSnapshot({
      cursorPath: join(dir, "cursor2.json"),
      listingStore,
      guideStore,
      now: () => new Date("2026-09-14T12:00:00.000Z"),
      loadHoldings,
      fetchHolding,
      rateLimitMs: 0,
    });
    expect(second.cursor.skippedFresh).toBe(1);
    expect(guideStore.rows).toHaveLength(1);
  });
});
