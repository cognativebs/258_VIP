import { randomUUID } from "node:crypto";
import {
  CardScanSchema,
  FieldSessionSchema,
  IdentificationGoldenCaseSchema,
  IdentificationProviderNameSchema,
  type CardScan,
  type FieldMode,
  type FieldSession,
  type IdentificationGoldenCase,
  type IdentificationProviderName,
} from "./schemas.js";

export class IdentificationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentificationContractError";
  }
}

export const ALLOWED_IDENTIFICATION_PROVIDERS = IdentificationProviderNameSchema.options;

export const FORBIDDEN_IDENTIFICATION_PROVIDERS = ["yugioh", "sportscardspro"] as const;

export function assertAllowedProvider(name: string): IdentificationProviderName {
  const normalized = name.toLowerCase().replace(/[\s_-]/g, "");
  if (
    FORBIDDEN_IDENTIFICATION_PROVIDERS.includes(
      normalized as (typeof FORBIDDEN_IDENTIFICATION_PROVIDERS)[number],
    )
  ) {
    throw new IdentificationContractError(
      `${name} is out of scope (Yu-Gi-Oh and SportsCardsPro were explicitly scoped down)`,
    );
  }
  return IdentificationProviderNameSchema.parse(name);
}

/** Four named interfaces — no matching or price-calc implementations in this phase. */
export type CardIdentificationProvider = {
  readonly name: IdentificationProviderName;
  readonly version: string;
};

export type CatalogProvider = {
  readonly name: IdentificationProviderName;
};

export type MarketDataProvider = {
  readonly name: IdentificationProviderName;
};

export type MarketplaceCatalogProvider = {
  readonly name: IdentificationProviderName;
};

export function createFieldSession(input: {
  id?: string;
  mode: FieldMode;
  startedAt: Date;
  locationContext?: string | null;
}): FieldSession {
  return FieldSessionSchema.parse({
    id: input.id ?? randomUUID(),
    mode: input.mode,
    startedAt: input.startedAt,
    endedAt: null,
    locationContext: input.locationContext ?? null,
  });
}

export function recordCardScan(input: {
  id?: string;
  capturedAt: Date;
  imageRef: string;
  physicalFingerprint?: string | null;
  source?: string;
}): CardScan {
  return CardScanSchema.parse({
    id: input.id ?? randomUUID(),
    capturedAt: input.capturedAt,
    imageRef: input.imageRef,
    physicalFingerprint: input.physicalFingerprint ?? null,
    source: input.source ?? "field_capture",
  });
}

export function assertCardScanImmutable(before: CardScan, after: CardScan): void {
  if (
    before.capturedAt.getTime() !== after.capturedAt.getTime() ||
    before.imageRef !== after.imageRef ||
    before.physicalFingerprint !== after.physicalFingerprint ||
    before.source !== after.source
  ) {
    throw new IdentificationContractError(
      "card_scan is immutable; corrections happen in card_identification",
    );
  }
}

export type CardIdentification = {
  id: string;
  cardScanId: string;
  confirmedAssetId: string | null;
  chosenCandidateId: string | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  needsReview: boolean;
  supersededBy: string | null;
  createdAt: Date;
};

export function openIdentification(cardScanId: string, createdAt: Date): CardIdentification {
  return {
    id: randomUUID(),
    cardScanId,
    confirmedAssetId: null,
    chosenCandidateId: null,
    confirmedBy: null,
    confirmedAt: null,
    needsReview: true,
    supersededBy: null,
    createdAt,
  };
}

/**
 * Disagreement produces a NEW row. The old row only gets supersededBy set.
 * needs_review is never auto-cleared.
 */
export function supersedeIdentification(
  previous: CardIdentification,
  nextConfirmedAssetId: string | null,
  confirmedBy: string,
  at: Date,
): { previous: CardIdentification; next: CardIdentification } {
  if (previous.supersededBy) {
    throw new IdentificationContractError("Identification already superseded");
  }
  const next: CardIdentification = {
    id: randomUUID(),
    cardScanId: previous.cardScanId,
    confirmedAssetId: nextConfirmedAssetId,
    chosenCandidateId: null,
    confirmedBy,
    confirmedAt: nextConfirmedAssetId ? at : null,
    needsReview: nextConfirmedAssetId == null,
    supersededBy: null,
    createdAt: at,
  };
  return {
    previous: { ...previous, supersededBy: next.id },
    next,
  };
}

export function addGoldenCase(input: {
  id?: string;
  cardScanId: string;
  knownCorrectAssetId: string;
  category?: string | null;
  addedAt?: Date;
}): IdentificationGoldenCase {
  return IdentificationGoldenCaseSchema.parse({
    id: input.id ?? randomUUID(),
    cardScanId: input.cardScanId,
    knownCorrectAssetId: input.knownCorrectAssetId,
    category: input.category ?? null,
    addedAt: input.addedAt ?? new Date(),
  });
}

/** Auction max-bid and trade basket-equality are deferred — not stubbed. */
export function auctionMaxBid(): never {
  throw new IdentificationContractError(
    "Auction max-bid calc is deferred; Field Modes ship as session containers only",
  );
}

export function tradeBasketEquality(): never {
  throw new IdentificationContractError(
    "Trade basket-equality calc is deferred; Field Modes ship as session containers only",
  );
}
