/** Collector face → VIP scan intake (Ricoh fi-8170). Browser calls go same-origin. */

function vipBase(): string {
  if (process.env.NEXT_PUBLIC_VIP_API_URL) return process.env.NEXT_PUBLIC_VIP_API_URL;
  if (typeof window !== "undefined") return "/api/vip";
  return "http://127.0.0.1:8787";
}

const SCAN_TIMEOUT_MS = 60_000;

export type ScanCategory = "sports" | "pokemon" | "mtg";

export type ScanMeta = {
  version: string;
  device: string;
  qualityTier: string;
  ebayListing: { configured: boolean; note: string };
  pipeline: string[];
  deferred: string[];
  inbox: { root: string | null; configured: boolean; note: string };
};

export type IdentityCandidate = {
  catalogKey: string;
  category: ScanCategory;
  displayName: string;
  setName?: string | null;
  collectorNumber?: string | null;
  year?: number | null;
  confidence: number;
  matchReasons: string[];
};

export type DuplicateMatch = {
  holdingId: string;
  assetName: string;
  quantity: number;
  matchKind: string;
  confidence: number;
  notes?: string;
};

export type ScanUnit = {
  id: string;
  unitIndex: number;
  status: string;
  frontStorageRef: string;
  backStorageRef?: string | null;
  candidates: IdentityCandidate[];
  selectedCandidateKey?: string | null;
  duplicateAlert?: { duplicates: DuplicateMatch[] } | null;
  decisionAction?: string | null;
  holdingId?: string | null;
};

export type ScanBatch = {
  id: string;
  device: string;
  status: string;
  categoryHint?: ScanCategory | null;
  notes?: string;
  units: ScanUnit[];
  createdAt: string;
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

export function fetchScanMeta(): Promise<ScanMeta> {
  return vipFetch<ScanMeta>("/api/scan");
}

export function fetchScanBatches(): Promise<{ count: number; batches: ScanBatch[] }> {
  return vipFetch("/api/scan/batches");
}

export function importScanFolder(body: {
  folder?: string;
  categoryHint?: ScanCategory | null;
  notes?: string;
  pairing?: "sequential_duplex" | "filename_front_back";
}): Promise<{ folder: string; fileCount: number; batch: ScanBatch }> {
  return vipFetch("/api/scan/import-folder", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function confirmScanUnit(
  unitId: string,
  body: {
    selectedCandidateKey: string;
    acknowledgeDuplicates?: boolean;
    quantity?: number;
    queueEbayListingDraft?: boolean;
  },
): Promise<{ ok: boolean; outputAction?: string; note?: string; error?: string }> {
  return vipFetch(`/api/scan/units/${encodeURIComponent(unitId)}/confirm`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
