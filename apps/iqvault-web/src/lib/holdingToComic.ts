import type { Holding } from "./api";
import type { ComicRow, ComicsMeta } from "./comicTypes";
import { tcgCardDisplay } from "./tcgCard";

/** Map VIP holdings into CLZ keys so the terminal works on the shared API alone. */
export function holdingToComicRow(h: Holding): ComicRow {
  return {
    id: h.id,
    Series: h.series,
    "Issue Full": h.issue,
    Publisher: h.publisher,
    "Edition / Variant": "",
    "Collection Pillar": h.pillar ?? "General Inventory",
    "Current Price": h.currentPrice,
    "Museum Score": h.museumScore,
    "Investment Score": h.investmentScore,
    "Liquidity Score": h.liquidityScore,
    Recommendation: h.recommendationLabel,
    "Sell Priority": h.sellPriority,
    Quantity: h.quantity,
    Duplicate: "No",
    "Needs Grading": h.needsGrading ? "Yes" : "No",
    "Needs Photo": h.needsPhoto ? "Yes" : "No",
    "Needs Verification": h.needsVerification ? "Yes" : "No",
    "Assumed Grade": h.assumedGrade,
    "Grade Rating": h.gradeRating,
    "Verification Notes": h.verificationNotes,
    "Cover Image URL": h.coverImageUrl ?? "",
    Title: h.cardName ?? "",
    "Slab Status": h.gradeRating != null ? "Slabbed" : "Raw",
    Location: null,
    "Is Key Comic": "No",
    "Upgrade Candidate": "No",
  };
}

/** Pokémon row for the Bloomberg table — Title is the printed name; cover is Inspector-only. */
export function holdingToPokemonRow(h: Holding): ComicRow {
  const d = tcgCardDisplay(h);
  return {
    ...holdingToComicRow(h),
    Title: d.cardName,
    "Cover Image URL": d.artUrl ?? "",
    Series: d.setName,
    "Issue Full": d.number,
    "Edition / Variant": h.rarity ?? "",
  };
}

export function metaFromHoldings(rows: ComicRow[]): ComicsMeta {
  const totalValue = rows.reduce(
    (s, r) => s + (Number(r["Current Price"]) || 0) * (Number(r.Quantity) || 1),
    0,
  );
  const museumCandidates = rows.filter((r) => r.Recommendation === "Museum Candidate").length;
  const pillarMap = new Map<string, number>();
  for (const r of rows) {
    const p = String(r["Collection Pillar"] || "Unknown");
    pillarMap.set(p, (pillarMap.get(p) ?? 0) + 1);
  }
  return {
    recordCount: rows.length,
    totalValue: Math.round(totalValue * 100) / 100,
    museumCandidates,
    pillars: [...pillarMap.entries()].map(([name, count]) => ({ name, count })),
    locations: [],
    source: "vip-api",
  };
}
