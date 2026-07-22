import { createHash } from "node:crypto";

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeKey(parts: {
  sourceId: string;
  title: string;
  url?: string | null;
  externalId?: string | null;
}): string {
  if (parts.externalId) return `${parts.sourceId}:id:${parts.externalId}`;
  if (parts.url) return `${parts.sourceId}:url:${parts.url.trim().toLowerCase()}`;
  const norm = normalizeText(parts.title);
  const h = createHash("sha256").update(norm).digest("hex").slice(0, 16);
  return `${parts.sourceId}:title:${h}`;
}

/** Token Jaccard similarity for novelty vs prior events. */
export function textSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Novelty: 1 = new info, 0 = pure repetition of prior corpus.
 * Quarantine recommended when novelty is very low (noise/repeat).
 */
export function noveltyScore(candidate: string, priorBodies: string[]): {
  score: number;
  maxSimilarity: number;
  suggestQuarantine: boolean;
} {
  if (priorBodies.length === 0) {
    return { score: 1, maxSimilarity: 0, suggestQuarantine: false };
  }
  let maxSimilarity = 0;
  for (const p of priorBodies) {
    maxSimilarity = Math.max(maxSimilarity, textSimilarity(candidate, p));
  }
  const score = Number((1 - maxSimilarity).toFixed(3));
  return {
    score,
    maxSimilarity: Number(maxSimilarity.toFixed(3)),
    suggestQuarantine: maxSimilarity >= 0.85,
  };
}
