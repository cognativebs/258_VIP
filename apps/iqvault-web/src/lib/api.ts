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

export { BINDER_URL, ORCHESTR8_CONSOLE_URL } from "./popoutLinks";

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

/**
 * VIP writes (intelligence desk). The API answers 400 with `{ error }` on a
 * rejected write — surface that message instead of a bare status code, since
 * these rejections are the guardrails (immutable rows, bad probabilities).
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
  timeoutMs = API_TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${vipApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(`API ${path} timed out after ${timeoutMs}ms — is it running but stuck?`);
    }
    throw e;
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `status ${res.status}`;
    throw new Error(`API ${path} rejected: ${detail}`);
  }
  return parsed as T;
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
  cardName?: string | null;
  rarity?: string | null;
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
