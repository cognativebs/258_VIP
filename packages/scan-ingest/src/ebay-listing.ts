import { randomUUID } from "node:crypto";
import { markInferred } from "@vip/evidence";
import { EBAY_LISTING_RULE } from "./constants.js";
import type {
  EbayListingDraft,
  IdentityCandidate,
  ScanCategory,
  ScanUnit,
} from "./schemas.js";

export type EbayListingCredentials = {
  /** Application / user OAuth token with sell APIs. */
  oauthToken?: string | null;
  /** Future: EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / refresh token. */
  clientId?: string | null;
  clientSecret?: string | null;
};

/**
 * Build an eBay listing draft for a confirmed scan unit.
 * Idle without developer tokens — never invents a live listing submission.
 */
export function buildEbayListingDraft(
  unit: ScanUnit,
  candidate: IdentityCandidate,
  creds: EbayListingCredentials = {},
  now: Date = new Date(),
): EbayListingDraft {
  const title = buildListingTitle(candidate);
  const token = creds.oauthToken?.trim();
  const hasAppCreds = Boolean(
    creds.clientId?.trim() && creds.clientSecret?.trim(),
  );

  if (!token && !hasAppCreds) {
    return {
      id: randomUUID(),
      unitId: unit.id,
      holdingId: unit.holdingId ?? null,
      title,
      categoryHint: candidate.category,
      status: "pending_credentials",
      emptyReason:
        "eBay developer tokens not configured — draft held idle (set EBAY_OAUTH_TOKEN or client credentials)",
      listingPayload: {
        title,
        categoryHint: candidate.category,
        externalIds: candidate.externalIds,
        imageRefs: [unit.frontStorageRef, unit.backStorageRef].filter(Boolean),
        condition: "USED",
        format: "FixedPrice",
      },
      provenance: markInferred({
        source: "ebay_listing_draft",
        ruleOrModelVersion: EBAY_LISTING_RULE,
        confidence: 0.3,
        notes: "Draft only · awaiting developer tokens · not submitted",
      }),
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id: randomUUID(),
    unitId: unit.id,
    holdingId: unit.holdingId ?? null,
    title,
    categoryHint: candidate.category,
    status: "draft_ready",
    listingPayload: {
      title,
      categoryHint: candidate.category,
      externalIds: candidate.externalIds,
      imageRefs: [unit.frontStorageRef, unit.backStorageRef].filter(Boolean),
      condition: "USED",
      format: "FixedPrice",
      // Inventory API submit stays behind credentials + human price decision.
      submitReady: false,
    },
    provenance: markInferred({
      source: "ebay_listing_draft",
      ruleOrModelVersion: EBAY_LISTING_RULE,
      confidence: 0.6,
      notes: "Draft payload ready · price/range + human Sell decision still required",
    }),
    createdAt: now,
    updatedAt: now,
  };
}

export function buildListingTitle(candidate: IdentityCandidate): string {
  const parts = [
    candidate.year?.toString(),
    candidate.setName,
    candidate.displayName,
    candidate.collectorNumber && `#${candidate.collectorNumber}`,
  ].filter(Boolean);
  return parts.join(" ").slice(0, 80);
}

export function ebayCredsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EbayListingCredentials {
  return {
    oauthToken: env.EBAY_OAUTH_TOKEN ?? null,
    clientId: env.EBAY_CLIENT_ID ?? null,
    clientSecret: env.EBAY_CLIENT_SECRET ?? null,
  };
}

export function categoryToEbayLeafHint(category: ScanCategory): string {
  switch (category) {
    case "pokemon":
      return "183050"; // Toys & Hobbies > Collectible Card Games > Pokémon
    case "mtg":
      return "19107";
    case "sports":
      return "212"; // Sports Mem, Cards & Fan Shop > Sports Trading Cards
    default:
      return "212";
  }
}
