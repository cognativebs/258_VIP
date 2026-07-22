const API_BASE = process.env.NEXT_PUBLIC_VIP_API_URL ?? "http://localhost:8787";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    next: { revalidate: 0 },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

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
  provenance: Provenance;
};
