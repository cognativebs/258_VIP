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

/** Process-local intake store (Postgres capture_session is the durable path). */
const store = new ScanSessionStore();

export function getScanStore(): ScanSessionStore {
  return store;
}

export function resetScanStoreForTests(): void {
  store.clear();
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
      pairing: "sequential_duplex",
      categoryHint: body.categoryHint ?? null,
      notes: body.notes,
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
      "PaperStream / folder drop",
      "duplex pair",
      "ID candidates (inferred)",
      "duplicate alert",
      "operator confirm → inventory Hold",
      "optional eBay listing draft",
    ],
    deferred: ["museum quality capture", "live eBay Inventory API submit"],
  };
}
