/**
 * Browser: same-origin `/api/vip/*` rewrite → VIP :8787 (see next.config.ts).
 * That way the Comics tab cannot accidentally hit a different machine's old
 * localhost:8787 (the classic 120-sample + 5-seed = 125 bug).
 * Server / explicit override: NEXT_PUBLIC_VIP_API_URL or http://127.0.0.1:8787.
 */
function vipApiBase(): string {
  if (process.env.NEXT_PUBLIC_VIP_API_URL) return process.env.NEXT_PUBLIC_VIP_API_URL;
  if (typeof window !== "undefined") return "/api/vip";
  return "http://127.0.0.1:8787";
}

export const BINDER_URL = process.env.NEXT_PUBLIC_BINDER_URL ?? "http://localhost:3010";

/**
 * Default timeout for VIP API calls. Without this, a backend that accepts a
 * TCP connection but never responds (stuck process, not just "down") can hang
 * a server component's fetch — and the whole :3000 page — indefinitely.
 * Inventory is ~2.5MB for 2,700 comics — allow longer than the default.
 */
const API_TIMEOUT_MS = 8000;
const INVENTORY_TIMEOUT_MS = 30_000;

export async function apiGet<T>(path: string, timeoutMs?: number): Promise<T> {
  const ms =
    timeoutMs ??
    (path.startsWith("/api/inventory") ? INVENTORY_TIMEOUT_MS : API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${vipApiBase()}${path}`, {
      next: { revalidate: 0 },
      cache: "no-store",
      signal: AbortSignal.timeout(ms),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(`API ${path} timed out after ${ms}ms — is it running but stuck?`);
    }
    throw e;
  }
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type BinderSummary = {
  id: string;
  name: string;
  pages: number;
  filledSlots: number;
  ownedSlots: number;
  needSlots: number;
  ownedMarketSum: number;
  needMarketSum: number;
  updatedAt: number | null;
};

export type TcgBindersResponse = {
  available: boolean;
  dbPath: string;
  error: string | null;
  binders: BinderSummary[];
  filledSlots: number;
  ownedSlots: number;
  needSlots: number;
  store?: "postgres" | "sqlite";
};

export type Provenance = {
  source: string;
  method: string;
  confidence: number;
  verificationStatus: string;
  notes?: string;
  ruleOrModelVersion: string;
};

export type Holding = {
  id: string;
  assetName: string;
  series: string;
  issue: string;
  publisher: string;
  quantity: number;
  pillar: string | null;
  museumScore: number | null;
  investmentScore: number | null;
  liquidityScore: number | null;
  recommendationLabel: string | null;
  sellPriority: "High" | "Medium" | "Low" | null;
  needsGrading: boolean;
  needsPhoto: boolean;
  needsVerification: boolean;
  verificationNotes: string | null;
  currentPrice: number | null;
  assumedGrade: string | null;
  gradeRating: number | null;
  coverImageUrl?: string | null;
  externalIds?: { source: string; externalValue: string }[];
  provenance: Provenance;
};

export type ComicsSnapshotInfo = {
  id: string;
  contentHash: string;
  shortHash: string;
  ingestedAt: string;
  recordCount: number | null;
  ageDays: number;
  label: string;
};

export type InventoryResponse = {
  count: number;
  comicsCount: number;
  comicsSource: "postgres" | "unavailable";
  comicsAvailable: boolean;
  comicsError: string | null;
  comicsSnapshot: ComicsSnapshotInfo | null;
  totalValueEstimate: { amount: number; note: string; confidence: string };
  tcgSource?: string;
  binderDb?: { available: boolean; filledSlots: number; error: string | null };
  holdings: Holding[];
};

export type Signal = {
  id: string;
  signalType: string;
  body: string;
  sourceUrl?: string | null;
  signalDate: string;
  noveltyScore?: number | null;
  quarantineStatus: string;
  title?: string;
};
