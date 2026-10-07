/**
 * Pokémon FMV for the collection page (GET /api/pokemon/fmv): PriceCharting guide ranges per
 * condition, read from stored daily snapshots. A vendor guide, never sold comps; confidence is
 * capped at 0.75. A card whose PriceCharting match still needs review shows that, not a price.
 */

export type FmvRange = {
  condition: string;
  conditionAssumed: boolean;
  low: number;
  high: number;
  latest: number;
  latestOn: string;
  snapshots: number;
  recencyDays: number;
  confidence: number;
};

export type FmvCard = {
  externalId: string;
  name: string;
  match: { productId: string; productName: string; needsReview: boolean } | null;
  fmv: FmvRange[];
};

export type FmvResponse = { asOf: string; windowDays: number; cards: FmvCard[] };

const money = (n: number) => `$${n.toFixed(2)}`;
const span = (r: FmvRange) => (r.low === r.high ? money(r.low) : `${money(r.low)}–${money(r.high)}`);

export function conditionLabel(r: Pick<FmvRange, "condition" | "conditionAssumed">): string {
  if (r.condition === "NM" && r.conditionAssumed) return "NM assumed";
  return r.condition.replace(/^GRADE_/, "Grade ").replace(/_/g, " ").replace(/(\d) (\d)$/, "$1.$2");
}

/** Table cell: the ungraded range first, then the PSA 10 range; snapshots, age and confidence. */
export function fmvCell(card: FmvCard | undefined): string {
  if (!card) return "not priced";
  if (!card.match) return "no PriceCharting match";
  if (card.match.needsReview) return "match needs review";
  const raw = card.fmv.find((r) => r.condition === "NM");
  const lead = raw ?? card.fmv[0];
  if (!lead) return "no guide snapshot yet";
  const psa = card.fmv.find((r) => r.condition === "PSA_10");
  const parts = [`${conditionLabel(lead)} ${span(lead)}`];
  if (psa && psa !== lead) parts.push(`PSA 10 ${span(psa)}`);
  return `${parts.join(" · ")} · ${lead.snapshots}× · ${lead.recencyDays}d · conf ${lead.confidence.toFixed(2)}`;
}

/** Sort key: the ungraded low (or the first condition's low). */
export function fmvLow(card: FmvCard | undefined): number | null {
  if (!card?.match || card.match.needsReview) return null;
  const lead = card.fmv.find((r) => r.condition === "NM") ?? card.fmv[0];
  return lead ? lead.low : null;
}

/** Inspector lines, one per condition. */
export function fmvDetail(card: FmvCard | undefined): string[] {
  if (!card) return ["Not priced — only Binder owned / wishlist cards are priced (daily)."];
  if (!card.match) return ["No PriceCharting product found for this card yet."];
  if (card.match.needsReview) {
    return [
      `Possible match: ${card.match.productName} (PriceCharting ${card.match.productId}) — needs your review before it is priced.`,
      `Confirm: npm run job:pokemon-prices -- confirm ${card.externalId} ${card.match.productId} --confirm-operator`,
    ];
  }
  if (!card.fmv.length) return [`Matched to ${card.match.productName}; no guide snapshot in the window yet.`];
  return [
    ...card.fmv.map(
      (r) =>
        `${conditionLabel(r)}: ${span(r)} · latest ${money(r.latest)} on ${r.latestOn} · ${r.snapshots} snapshot${r.snapshots === 1 ? "" : "s"} · conf ${r.confidence.toFixed(2)}`,
    ),
    `PriceCharting guide (sale-derived), matched to ${card.match.productName}. Not sold comps.`,
  ];
}
