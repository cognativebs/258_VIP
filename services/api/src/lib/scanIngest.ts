import {
  ConfirmUnitRequestSchema,
  FIXTURE_CATALOG,
  SCAN_HOLDING_SOURCE,
  SCAN_INGEST_RULE,
  SCAN_INGEST_VERSION,
  ScanBatchInputSchema,
  ScanSessionStore,
  batchInputFromPages,
  confirmScanUnit,
  ebayCredsFromEnv,
  openScanBatch,
  type ConfirmUnitRequest,
  type InventoryLookupRow,
  type ScanBatchInput,
  type ScanPageInput,
} from "@vip/scan-ingest";
import type { ApiHolding } from "./holdings.js";

/** Process-local intake store (Postgres capture_session is the durable path). */
const store = new ScanSessionStore();

export function getScanStore(): ScanSessionStore {
  return store;
}

export function resetScanStoreForTests(): void {
  store.clear();
}

/** Map VIP inventory rows into the scan duplicate-check shape. */
export function inventoryLookupFromHoldings(
  holdings: ApiHolding[],
): InventoryLookupRow[] {
  return holdings.map((h) => ({
    id: h.id,
    assetName: h.assetName,
    quantity: h.quantity,
    externalIds: h.externalIds.map((e) => ({
      source: e.source,
      value: e.externalValue,
    })),
    // Prefer Pokémon/TCG external id as catalog key when present.
    catalogKey:
      h.externalIds.find((e) =>
        ["pokemontcg", "tcgdex", "cardladder", "scryfall"].includes(
          e.source.toLowerCase(),
        ),
      )?.externalValue ?? undefined,
  }));
}

export type OpenScanBody = {
  device?: string;
  categoryHint?: "sports" | "pokemon" | "mtg" | null;
  notes?: string;
  /** Duplex units already paired by the client / PaperStream. */
  units?: ScanBatchInput["units"];
  /** Flat page list — server pairs sequential duplex. */
  pages?: Array<
    ScanPageInput & {
      fileName?: string;
      sequence?: number;
    }
  >;
  inventory?: InventoryLookupRow[];
  pairing?: "sequential_duplex" | "filename_front_back";
};

export function openScanFromApi(body: OpenScanBody) {
  let input: ScanBatchInput;
  if (body.units?.length) {
    input = ScanBatchInputSchema.parse({
      device: body.device ?? "ricoh_fi8170",
      purpose: "inventory_intake",
      qualityTier: "intake",
      categoryHint: body.categoryHint ?? null,
      notes: body.notes,
      units: body.units,
    });
  } else if (body.pages?.length) {
    const pages = body.pages.map((p, i) => ({
      ...p,
      discoveredAt: new Date(),
      sequence: p.sequence ?? i,
      mimeType: p.mimeType ?? "image/jpeg",
      face: p.face ?? "unknown",
    }));
    input = batchInputFromPages(pages, {
      pairing: body.pairing ?? "sequential_duplex",
      categoryHint: body.categoryHint ?? null,
      notes: body.notes,
      device: body.device,
    });
  } else {
    throw new Error("body.units or body.pages required");
  }

  return openScanBatch(input, {
    store,
    catalog: FIXTURE_CATALOG,
    inventory: body.inventory,
    ebayCreds: ebayCredsFromEnv(),
  });
}

export function confirmScanFromApi(
  body: ConfirmUnitRequest,
  inventory?: InventoryLookupRow[],
) {
  const parsed = ConfirmUnitRequestSchema.parse(body);
  return confirmScanUnit(parsed, {
    store,
    catalog: FIXTURE_CATALOG,
    inventory,
    ebayCreds: ebayCredsFromEnv(),
  });
}

export function listScanBatches() {
  return store.listBatches();
}

export function getScanBatch(id: string) {
  return store.getBatch(id);
}

export function scanMeta() {
  return {
    version: SCAN_INGEST_VERSION,
    source: SCAN_HOLDING_SOURCE,
    ruleOrModelVersion: SCAN_INGEST_RULE,
    device: "ricoh_fi8170",
    qualityTier: "intake",
    ebayListing: {
      configured: Boolean(
        process.env.EBAY_OAUTH_TOKEN?.trim() ||
          (process.env.EBAY_CLIENT_ID?.trim() &&
            process.env.EBAY_CLIENT_SECRET?.trim()),
      ),
      note: "Listing drafts stay idle without developer tokens; never auto-submit",
    },
    pipeline: [
      "PaperStream / folder drop or upload (source extensible)",
      "immutable master copy + orientation recorded",
      "duplex pair / filename front (ambiguous → review)",
      "front+back evidence fusion (conflicts listed)",
      "base identity vs parallel confidence",
      "HIGH / MEDIUM / LOW / CONFLICT review route",
      "physical reimport (hash) vs same card type",
      "draft inventory candidate (confirm → Dealer · Sell)",
      "LIVE range (Browse listings · unverified)",
      "eBay listing draft (submitReady false)",
    ],
    deferred: [
      "museum quality capture",
      "live eBay Inventory API submit",
      "TWAIN / scanner driver control",
      "pixel resample derivatives (no sharp/Pillow in-tree)",
    ],
    reviewThresholds: {
      highMin: process.env.VIP_SCAN_HIGH_MIN ?? "0.8",
      mediumMin: process.env.VIP_SCAN_MEDIUM_MIN ?? "0.45",
    },
    scannerProfileDefault: "004_Cards",
  };
}
