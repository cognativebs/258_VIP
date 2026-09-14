import { join } from "node:path";
import {
  runComicsCompsWalk,
  type ComicsCompsWalkOptions,
  type ComicsCompsWalkResult,
} from "./comicsCompsWalk.js";
import { postgresListingObservationStore } from "./listingObservation.js";
import {
  chicagoSnapshotOn,
  guideRowsFromLiveObservations,
  postgresGuideSnapshotStore,
  type GuideSnapshotStore,
} from "./guideSnapshot.js";
import type { ListingObservationStore } from "./listingObservation.js";

export const COMICS_GUIDE_SNAPSHOT_CURSOR = "comics-guide-snapshot.json";

export async function runComicsGuideSnapshot(opts: {
  cursorPath?: string;
  resume?: boolean;
  dryRun?: boolean;
  maxHoldings?: number;
  listingStore?: ListingObservationStore;
  guideStore?: GuideSnapshotStore;
  now?: () => Date;
  shouldStop?: () => boolean;
  loadHoldings?: ComicsCompsWalkOptions["loadHoldings"];
  fetchHolding?: ComicsCompsWalkOptions["fetchHolding"];
  rateLimitMs?: number;
}): Promise<ComicsCompsWalkResult> {
  const nowFn = opts.now ?? (() => new Date());
  const listingStore = opts.listingStore ?? postgresListingObservationStore();
  const guideStore = opts.guideStore ?? postgresGuideSnapshotStore();
  const cursorPath =
    opts.cursorPath ??
    process.env.VIP_COMICS_GUIDE_SNAPSHOT_CURSOR ??
    join(process.cwd(), ".state", COMICS_GUIDE_SNAPSHOT_CURSOR);

  return runComicsCompsWalk({
    publishers: ["all"],
    maxHoldings: opts.maxHoldings,
    dryRun: opts.dryRun,
    resume: opts.resume,
    cursorPath,
    store: listingStore,
    rateLimitMs: opts.rateLimitMs ?? Number(process.env.VIP_PRICECHARTING_GAP_MS ?? 1100),
    now: nowFn,
    shouldStop: opts.shouldStop,
    triggeredBy: "comics-guide-snapshot",
    loadHoldings: opts.loadHoldings,
    fetchHolding: opts.fetchHolding,
    isFresh: async (holdingSourceRowId, now) =>
      guideStore.hasSnapshot(holdingSourceRowId, chicagoSnapshotOn(now)),
    afterPersist: async (input) => {
      const rows = guideRowsFromLiveObservations(input);
      if (rows.length) await guideStore.upsert(rows);
    },
  });
}
