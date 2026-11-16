/**
 * Ingest decisions that do not touch the database.
 * Method and evidence class are stored on each row. Nothing here infers them later.
 */

export const INGEST_DESTINATIONS = [
  {
    id: "personal_collection",
    label: "Personal Collection",
    subtargets: ["binder", "hunt"] as const,
  },
  {
    id: "investment_vault",
    label: "Investment",
    subtargets: [] as const,
  },
  {
    id: "dealer_inventory",
    label: "Dealer Inventory",
    subtargets: [] as const,
  },
] as const;

export type IngestDestinationId = (typeof INGEST_DESTINATIONS)[number]["id"];
export type IngestSubtargetKind = "binder" | "hunt";

export const INGEST_METHODS = [
  {
    key: "scanner_hid",
    label: "Scanner (live)",
    evidenceClass: "device_capture",
    enabled: true,
    capture: "gtin",
  },
  {
    key: "scanner_batch",
    label: "Scanner (stored upload)",
    evidenceClass: "device_capture",
    enabled: true,
    capture: "gtin-paste",
  },
  {
    key: "image_capture",
    label: "Card images",
    evidenceClass: "image_identification",
    enabled: true,
    capture: "queue",
  },
  {
    key: "manual",
    label: "Manual entry",
    evidenceClass: "user_asserted",
    enabled: true,
    capture: "manual",
  },
  {
    key: "file_upload",
    label: "Upload images",
    evidenceClass: "image_identification",
    enabled: true,
    capture: "queue",
  },
  {
    key: "csv_import",
    label: "CSV / file import",
    evidenceClass: "bulk_import",
    enabled: true,
    capture: "csv",
  },
  {
    key: "api_import",
    label: "API import",
    evidenceClass: "external_system",
    enabled: false,
    disabledReason: "No sources connected",
    capture: "none",
  },
] as const;

export type IngestMethodKey = (typeof INGEST_METHODS)[number]["key"];
export type EvidenceClass = (typeof INGEST_METHODS)[number]["evidenceClass"];
export type Lifecycle = "draft" | "active" | "paused" | "abandoned" | "committed";

export type LifecycleAction = "activate" | "pause" | "abandon" | "resume" | "commit";

const DEST_IDS = new Set<string>(INGEST_DESTINATIONS.map((d) => d.id));

export function destinationById(id: string) {
  return INGEST_DESTINATIONS.find((d) => d.id === id) ?? null;
}

export function methodByKey(key: string) {
  return INGEST_METHODS.find((m) => m.key === key) ?? null;
}

export function assertDestinationChoice(
  destination: string,
  subtargetKind: string | null,
): { ok: true; destination: IngestDestinationId; subtargetKind: IngestSubtargetKind | null } | { ok: false; reason: string } {
  const dest = destinationById(destination);
  if (!dest) return { ok: false, reason: "Destination is not one of the collection buckets." };
  if (!subtargetKind) return { ok: true, destination: dest.id, subtargetKind: null };
  if (dest.id !== "personal_collection") {
    return { ok: false, reason: "Binder and hunt are sub-targets of Personal Collection." };
  }
  if (subtargetKind !== "binder" && subtargetKind !== "hunt") {
    return { ok: false, reason: "Sub-target must be a binder or a hunt." };
  }
  return { ok: true, destination: dest.id, subtargetKind };
}

export function assertMethod(key: string): { ok: true; method: (typeof INGEST_METHODS)[number] } | { ok: false; status: number; reason: string } {
  const method = methodByKey(key);
  if (!method) return { ok: false, status: 400, reason: "Unknown ingest method." };
  if (!method.enabled) return { ok: false, status: 409, reason: method.disabledReason ?? "No sources connected" };
  return { ok: true, method };
}

/** UPC identifies a SKU. Condition, grade, and printing are rejected. */
export function upcIdentityViolation(body: Record<string, unknown>): string | null {
  for (const key of ["condition", "grade", "assumedGrade", "printing", "variant"]) {
    if (body[key] != null && body[key] !== "") {
      return `A UPC cannot set ${key}. It identifies a product, not a printing or a condition.`;
    }
  }
  return null;
}

export function applyLifecycle(
  from: Lifecycle,
  action: LifecycleAction,
): { ok: true; to: Lifecycle } | { ok: false; reason: string } {
  if (from === "committed") return { ok: false, reason: "Committed is terminal." };
  if (action === "commit") {
    if (from !== "active" && from !== "paused") {
      return { ok: false, reason: "Commit starts from an active or paused batch." };
    }
    return { ok: true, to: "committed" };
  }
  if (action === "abandon") return { ok: true, to: "abandoned" };
  if (action === "pause") {
    if (from !== "active") return { ok: false, reason: "Only an active batch can pause." };
    return { ok: true, to: "paused" };
  }
  if (from === "active") return { ok: true, to: "active" };
  return { ok: true, to: "active" };
}

export function fixturesVisible(): boolean {
  return process.env.VIP_INGEST_FIXTURES === "1";
}

export function batchVisible(isFixture: boolean, showFixtures = fixturesVisible()): boolean {
  return showFixtures || !isFixture;
}

export type StageStripModel = {
  capture: "current" | "done" | "waiting";
  identified: number;
  captured: number;
  review: number;
  commitEnabled: boolean;
  partialAvailable: boolean;
};

export function deriveStages(input: {
  lifecycle: Lifecycle;
  captured: number;
  identified: number;
  review: number;
  acceptingRows: boolean;
}): StageStripModel {
  const capture =
    input.lifecycle === "active" && input.acceptingRows
      ? "current"
      : input.captured > 0
        ? "done"
        : "waiting";
  return {
    capture,
    identified: input.identified,
    captured: input.captured,
    review: input.review,
    commitEnabled: input.review === 0 && input.captured > 0 && input.lifecycle !== "committed",
    partialAvailable: input.review > 0 && input.captured > input.review && input.lifecycle !== "committed",
  };
}

export function isStale(lastActivityAt: string | Date, now = new Date()): boolean {
  const then = lastActivityAt instanceof Date ? lastActivityAt : new Date(lastActivityAt);
  return now.getTime() - then.getTime() > 30 * 24 * 60 * 60 * 1000;
}

/** GS1 mod-10. Stored form is 14 digits, zero-padded, as text. */
export function normalizeGtin(raw: string): { ok: true; gtin14: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "Enter a code." };
  if (!/^\d+$/.test(trimmed)) return { ok: false, reason: "A GTIN is digits only." };
  if (![8, 12, 13, 14].includes(trimmed.length)) {
    return { ok: false, reason: "GTIN must be 8, 12, 13, or 14 digits." };
  }
  const gtin14 = trimmed.padStart(14, "0");
  const check = Number(gtin14[13]);
  let sum = 0;
  for (let i = 0; i < 13; i += 1) {
    const weight = i % 2 === 0 ? 3 : 1;
    sum += Number(gtin14[i]) * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  if (check !== expected) {
    return { ok: false, reason: `Check digit does not match. Expected ${expected}.` };
  }
  return { ok: true, gtin14 };
}

/** Quantity is the count of scan events still in the rollup. Voided events stay in the log. */
export function rollupQuantity(
  events: { gtin14: string | null; quantity: number; voided: boolean }[],
  gtin14: string,
): number {
  return events.reduce((sum, event) => {
    if (event.voided || event.gtin14 !== gtin14) return sum;
    return sum + event.quantity;
  }, 0);
}

export function thinComps(releaseOn: string | null, now = new Date()): boolean {
  if (!releaseOn) return false;
  const release = new Date(`${releaseOn}T00:00:00Z`);
  if (Number.isNaN(release.getTime())) return false;
  const ageDays = (now.getTime() - release.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays >= 0 && ageDays < 90;
}

export function commitAllowed(input: {
  destination: IngestDestinationId;
  assetId: string | null;
  costBasis: number | null;
  acquiredOn: string | null;
  quantity: number;
  needsReview: boolean;
  subtargetKind: IngestSubtargetKind | null;
  slotId: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.assetId) return { ok: false, reason: "Product identity is not confirmed." };
  if (input.needsReview) return { ok: false, reason: "This row is still in review." };
  if (input.destination === "dealer_inventory") {
    if (input.costBasis == null) return { ok: false, reason: "Dealer inventory requires a cost basis." };
    if (input.quantity < 1) return { ok: false, reason: "Dealer inventory requires a quantity." };
  }
  if (input.destination === "investment_vault") {
    if (input.costBasis == null) return { ok: false, reason: "Investment requires a cost basis." };
    if (!input.acquiredOn) return { ok: false, reason: "Investment requires an acquisition date." };
  }
  if (input.subtargetKind === "binder" && !input.slotId) {
    return { ok: false, reason: "A binder commit needs a resolved slot." };
  }
  return { ok: true };
}

export function legacyLifecycle(status: string, id: string): Lifecycle {
  if (id === "ed919c12-4634-439f-b7b6-28d98fa328f3") return "abandoned";
  if (status === "closed") return "committed";
  if (status === "open" || status === "review") return "paused";
  return "paused";
}

export function isDestinationId(value: string): value is IngestDestinationId {
  return DEST_IDS.has(value);
}

/** Minimal CSV reader. Quotes may contain commas. A preset maps fields onto headers. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell.trim());
      cell = "";
      if (row.some((part) => part !== "")) rows.push(row);
      row = [];
      continue;
    }
    if (ch !== "\r") cell += ch;
  }
  row.push(cell.trim());
  if (row.some((part) => part !== "")) rows.push(row);
  return rows;
}

export function mapColumns(
  headers: string[],
  columnMap: Record<string, string>,
): Record<string, number | null> {
  const index = new Map(headers.map((header, i) => [header.trim().toLowerCase(), i]));
  const out: Record<string, number | null> = {};
  for (const [field, header] of Object.entries(columnMap)) {
    out[field] = index.get(header.trim().toLowerCase()) ?? null;
  }
  return out;
}
