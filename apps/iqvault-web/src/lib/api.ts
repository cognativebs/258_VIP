const API_BASE = process.env.NEXT_PUBLIC_VIP_API_URL ?? "http://localhost:8787";
export const BINDER_URL = process.env.NEXT_PUBLIC_BINDER_URL ?? "http://localhost:3010";

/**
 * Default timeout for VIP API calls. Without this, a backend that accepts a
 * TCP connection but never responds (stuck process, not just "down") can hang
 * a server component's fetch — and the whole :3000 page — indefinitely.
 */
const API_TIMEOUT_MS = 8000;

export async function apiGet<T>(path: string, timeoutMs = API_TIMEOUT_MS): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      next: { revalidate: 0 },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(`API ${path} timed out after ${timeoutMs}ms — is it running but stuck?`);
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
  externalIds?: { source: string; externalValue: string }[];
  provenance: Provenance;
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
