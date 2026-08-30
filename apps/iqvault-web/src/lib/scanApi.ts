/** Collector face → VIP scan intake (Ricoh fi-8170). Browser calls go same-origin. */

function vipBase(): string {
  if (process.env.NEXT_PUBLIC_VIP_API_URL) return process.env.NEXT_PUBLIC_VIP_API_URL;
  if (typeof window !== "undefined") return "/api/vip";
  return "http://127.0.0.1:8787";
}

const SCAN_TIMEOUT_MS = 120_000;

export type ScanCategory = "sports" | "pokemon" | "mtg";
export type ScanPairing = "auto" | "filename_front_back" | "sequential_duplex";

export type ScanMeta = {
  version: string;
  device: string;
  qualityTier: string;
  ebayListing: { configured: boolean; note: string };
  pipeline: string[];
  deferred: string[];
  inbox: { root: string | null; configured: boolean; note: string };
  reviewThresholds?: { highMin: string; mediumMin: string };
  scannerProfileDefault?: string;
};

export type ScanBatchTelemetry = {
  imagesReceived: number;
  cardsPaired: number;
  pairingFailures: number;
  cardsIdentified: number;
  high: number;
  medium: number;
  low: number;
  needsReview: number;
  conflicts: number;
  duplicateWarnings: number;
  processingFailures: number;
  avgMsPerCard: number;
  totalMs: number;
  estimatedCostUsd: number;
};

export type StagedCandidate = {
  catalogKey: string;
  displayName: string;
  category: string | null;
  setName: string | null;
  collectorNumber: string | null;
  confidence: number;
  matchReasons: string[];
  adapterId: string;
  assetId: string | null;
};

export type BaseVsParallel = {
  baseDisplayName: string | null;
  baseConfidence: number;
  parallelDisplayName: string | null;
  parallelConfidence: number;
  notes?: string;
};

export type StagedUnit = {
  id: string;
  unitIndex: number;
  status: string;
  frontStorageRef: string;
  backStorageRef: string | null;
  selectedCandidateKey: string | null;
  holdingId: string | null;
  confirmedAssetId: string | null;
  resolutionMode: string | null;
  topConfidence: number | null;
  confidenceBand: string | null;
  duplicateAcknowledged: boolean;
  decisionAction: string | null;
  candidates: StagedCandidate[];
  frontImageId?: string | null;
  backImageId?: string | null;
  pairingMethod?: string | null;
  pairingConfidence?: number | null;
  pairingNeedsReview?: boolean;
  orientation?: string | null;
  identificationStatus?: string | null;
  reviewStatus?: string | null;
  reviewRoute?: string | null;
  identityEvidence?: { conflictNotes?: string[] } | null;
  baseVsParallel?: BaseVsParallel | null;
  physicalReimport?: boolean;
};

export type StagedBatch = {
  id: string;
  device: string;
  status: string;
  categoryHint: string | null;
  notes: string | null;
  createdAt: string;
  units: StagedUnit[];
  source?: string | null;
  scannerProfile?: string | null;
  imageCount?: number | null;
  expectedCardCount?: number | null;
  processingStatus?: string | null;
  errorsWarnings?: string[];
  telemetry?: ScanBatchTelemetry | null;
};

async function vipFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${vipBase()}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `VIP ${path} failed (${res.status})`);
  }
  return data;
}

export function scanMediaUrl(imageId: string): string {
  return `${vipBase()}/api/scan/media/${encodeURIComponent(imageId)}`;
}

export function fetchScanMeta(): Promise<ScanMeta> {
  return vipFetch<ScanMeta>("/api/scan");
}

export function fetchScanBatches(): Promise<{
  count: number;
  batches: StagedBatch[];
  store: "postgres" | "memory";
  storeError?: string;
}> {
  return vipFetch("/api/scan/batches");
}

export type ImportScanResult = {
  folder: string;
  fileCount: number;
  staged: { unitCount: number; candidateCount: number } | null;
  stagingError: string | null;
  telemetry?: ScanBatchTelemetry;
  report?: Array<{
    card: string;
    pairing: string;
    baseIdentity: string;
    parallel: string;
    confidence: string;
    reviewStatus: string;
    inventoryCandidate: string;
  }>;
  errorsWarnings?: string[];
};

export function importScanFolder(body: {
  folder?: string;
  categoryHint?: ScanCategory | null;
  notes?: string;
  pairing?: ScanPairing;
  source?: string;
  scannerProfile?: string;
}): Promise<ImportScanResult> {
  return vipFetch("/api/scan/import-folder", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startScanUpload(): Promise<{ sessionId: string }> {
  return vipFetch("/api/scan/import-upload/start", { method: "POST" });
}

export function uploadScanFile(body: {
  sessionId: string;
  fileName: string;
  contentBase64: string;
}): Promise<{ ok: boolean; fileName: string; bytes: number }> {
  return vipFetch("/api/scan/import-upload/file", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function finishScanUpload(body: {
  sessionId: string;
  categoryHint?: ScanCategory | null;
  notes?: string;
  pairing?: ScanPairing;
  source?: string;
  scannerProfile?: string;
}): Promise<ImportScanResult> {
  return vipFetch("/api/scan/import-upload/finish", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** The ADR 0009 boundary: staging → canonical inventory. */
export function resolveScanUnit(
  unitId: string,
  body: { catalogKey: string; acknowledgeDuplicates?: boolean; quantity?: number },
): Promise<{ ok: boolean; holdingId?: string; alreadyResolved?: boolean; note?: string }> {
  return vipFetch(`/api/scan/units/${encodeURIComponent(unitId)}/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function rejectScanUnit(
  unitId: string,
  reason?: string,
): Promise<{ ok: boolean }> {
  return vipFetch(`/api/scan/units/${encodeURIComponent(unitId)}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}
