import { markInferred, markObserved } from "@vip/evidence";

export type ExternalIdRef = {
  source: string;
  externalValue: string;
};

export type ApiHolding = {
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
  /** CLZ / catalog cover URL when present — never invented. */
  coverImageUrl: string | null;
  externalIds: ExternalIdRef[];
  provenance: ReturnType<typeof markObserved> | ReturnType<typeof markInferred>;
};

function parseExternalIds(row: Record<string, unknown>): ExternalIdRef[] {
  const raw = row["ExternalIds"] ?? row["externalIds"];
  if (!Array.isArray(raw)) return [];
  const out: ExternalIdRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const source = String((item as { source?: unknown }).source ?? "").trim();
    const externalValue = String(
      (item as { externalValue?: unknown }).externalValue ?? "",
    ).trim();
    if (source && externalValue) out.push({ source, externalValue });
  }
  return out;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yes(v: unknown): boolean {
  return String(v ?? "").toLowerCase() === "yes" || v === true;
}

export function mapInventoryRow(row: Record<string, unknown>, index: number): ApiHolding {
  const series = String(row["Series"] ?? "");
  const issue = String(row["Issue Full"] ?? row["Issue"] ?? "");
  const needsVerification = yes(row["Needs Verification"]);
  const assumed = String(row["Assumed Grade"] ?? "");
  const gradeRating = num(row["Grade Rating"]);
  const externalIds = parseExternalIds(row);
  // Comics also carry externalIds (barcode, clz_hash, bp_comic). Only TCG
  // catalog sources mark a row as a Pokémon seed.
  const isPokemonSeed = externalIds.some((e) =>
    ["pokemontcg", "tcgdex", "tcgplayer"].includes(e.source.toLowerCase()),
  );
  const isNmAssumed =
    assumed.toLowerCase().includes("nm") ||
    (gradeRating === 0 && String(row["Slab Status"] ?? "").toLowerCase() === "raw");
  const source = isPokemonSeed ? "vip_pokemon_seed" : "clz_import";
  // ADR 0006 — Python owns CLZ ingest; keep the seed tag distinct.
  const ruleOrModelVersion = isPokemonSeed
    ? "pokemon-seed@0.1.0"
    : "clz-python-ingest@0.2.0";

  return {
    id: String(row["CLZ Hash"] ?? `holding-${index}`),
    assetName: [series, issue && `#${issue}`, row["Edition / Variant"]].filter(Boolean).join(" "),
    series,
    issue,
    publisher: String(row["Publisher"] ?? ""),
    quantity: num(row["Quantity"]) ?? 1,
    pillar: row["Collection Pillar"] != null ? String(row["Collection Pillar"]) : null,
    museumScore: num(row["Museum Score"]),
    investmentScore: num(row["Investment Score"]),
    liquidityScore: num(row["Liquidity Score"]),
    recommendationLabel:
      row["Recommendation"] != null ? String(row["Recommendation"]) : null,
    sellPriority: (["High", "Medium", "Low"] as const).includes(
      row["Sell Priority"] as "High",
    )
      ? (row["Sell Priority"] as "High" | "Medium" | "Low")
      : null,
    needsGrading: yes(row["Needs Grading"]),
    needsPhoto: yes(row["Needs Photo"]),
    needsVerification,
    verificationNotes:
      row["Verification Notes"] != null ? String(row["Verification Notes"]) : null,
    currentPrice: num(row["Current Price"]),
    assumedGrade: isNmAssumed ? "NM" : assumed || null,
    gradeRating: isNmAssumed || gradeRating === 0 ? null : gradeRating,
    coverImageUrl: (() => {
      const url = String(row["Cover Image URL"] ?? "").trim();
      return url || null;
    })(),
    externalIds,
    provenance: isNmAssumed
      ? markInferred({
          source,
          ruleOrModelVersion,
          notes: "NM assumed · unverified",
        })
      : markObserved({
          source,
          ruleOrModelVersion,
          confidence: 0.85,
        }),
  };
}
