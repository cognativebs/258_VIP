import { EBAY_TITLE_MAX_LEN, HYPE_WORDS, LISTING_BUILDER_RULE } from "./constants.js";
import { buildEbaySku } from "./sku.js";
import type { ListingDraftPayload, SellingAssetInput } from "./schemas.js";

const CATEGORY_LEAF: Record<SellingAssetInput["category"], string> = {
  pokemon: "183050",
  mtg: "19107",
  sports: "212",
  comic: "63",
  other: "1",
};

const FILLER = new Set(["the", "a", "an", "and", "of", "for", "with", "card"]);

/**
 * Build an eBay-ready draft payload. Does not call eBay.
 * Publish is blocked when required media or identity is missing.
 */
export function buildListingDraftPayload(asset: SellingAssetInput): ListingDraftPayload {
  const sku = asset.sku ?? buildEbaySku(asset.category, asset.holdingUuid ?? asset.inventoryId);
  const title = buildListingTitle(asset);
  const description = buildListingDescription(asset);
  const imageUrls = [asset.frontImageUri, asset.backImageUri].filter((u): u is string => Boolean(u));
  const blocked = publishBlockers(asset, imageUrls);
  return {
    sku,
    title,
    description,
    categoryId: CATEGORY_LEAF[asset.category],
    format: "FIXED_PRICE",
    condition: mapCondition(asset),
    imageUrls,
    aspects: buildAspects(asset),
    marketplaceId: "EBAY_US",
    quantity: Math.max(1, asset.quantity),
    recommendedListPrice: asset.fmv ? Math.round(asset.fmv.mid * 100) / 100 : null,
    minimumAcceptablePrice: asset.fmv ? Math.round(asset.fmv.low * 100) / 100 : null,
    currency: "USD",
    publishBlockedReasons: blocked,
  };
}

export function buildListingTitle(asset: SellingAssetInput): string {
  const raw = [
    asset.year?.toString(),
    asset.setName,
    asset.playerSubject,
    asset.cardNumber ? `#${String(asset.cardNumber).replace(/^#/, "")}` : null,
    asset.parallel,
    asset.grader,
    asset.grade,
    asset.team,
  ]
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = stripHype(raw || fallbackTitle(asset));
  return shortenTitle(cleaned, EBAY_TITLE_MAX_LEN);
}

export function buildListingDescription(asset: SellingAssetInput): string {
  const lines = [
    identityLine(asset),
    asset.condition || asset.grade
      ? `Condition/grade: ${[asset.grader, asset.grade, asset.condition].filter(Boolean).join(" ")}.`
      : "Condition: as photographed · grade inferred · unverified unless a slab is named.",
    asset.serialNumber ? `Serial: ${asset.serialNumber}.` : null,
    asset.autographFlag ? "Autograph indicated on the stored record." : null,
    asset.relicFlag ? "Memorabilia/relic indicated on the stored record." : null,
    "Shipping and handling follow the seller's configured eBay policies.",
    "No scarcity, population, or investment claims beyond the catalog fields above.",
  ].filter(Boolean);
  return [...lines, `Rule ${LISTING_BUILDER_RULE}.`].join("\n");
}

export function publishBlockers(asset: SellingAssetInput, imageUrls: string[]): string[] {
  const reasons: string[] = [];
  if (imageUrls.length < 1) reasons.push("IMAGE_REQUIRED");
  if (asset.category === "comic") {
    if (!asset.setName && !asset.playerSubject) reasons.push("IDENTITY_SERIES_REQUIRED");
    if (!asset.cardNumber) reasons.push("IDENTITY_ISSUE_REQUIRED");
  } else {
    if (!asset.playerSubject) reasons.push("IDENTITY_PLAYER_REQUIRED");
    if (!asset.setName) reasons.push("IDENTITY_SET_REQUIRED");
  }
  if (asset.salesPathState === "sold") reasons.push("ALREADY_SOLD");
  if (asset.currentDisposition === "PC") reasons.push("PERSONAL_COLLECTION");
  if (asset.currentDisposition === "HOLD" || asset.currentDisposition === "GRADE") {
    reasons.push("DISPOSITION_BLOCKS_PUBLISH");
  }
  return reasons;
}

export function stripHype(text: string): string {
  let out = text;
  for (const word of HYPE_WORDS) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");
    out = out.replace(re, "");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function shortenTitle(title: string, max: number): string {
  if (title.length <= max) return title;
  const tokens = title.split(" ");
  const kept: string[] = [];
  for (const token of tokens) {
    if (FILLER.has(token.toLowerCase()) && tokens.length > 4) continue;
    const next = [...kept, token].join(" ");
    if (next.length > max) break;
    kept.push(token);
  }
  let out = kept.join(" ");
  if (out.length > max) out = out.slice(0, max).trim();
  return out || title.slice(0, max);
}

function fallbackTitle(asset: SellingAssetInput): string {
  return [asset.setName, asset.playerSubject, asset.cardNumber].filter(Boolean).join(" ") || "Collectible";
}

function identityLine(asset: SellingAssetInput): string {
  return [
    asset.year,
    asset.manufacturer,
    asset.setName,
    asset.playerSubject,
    asset.cardNumber ? `#${asset.cardNumber}` : null,
    asset.parallel,
    asset.team,
    asset.sport,
  ]
    .filter(Boolean)
    .join(" ");
}

function mapCondition(asset: SellingAssetInput): string {
  if (asset.grader && asset.grade) return "LIKE_NEW";
  const c = (asset.condition ?? "").toLowerCase();
  if (c.includes("mint") || c === "nm") return "LIKE_NEW";
  return "USED_VERY_GOOD";
}

function buildAspects(asset: SellingAssetInput): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  const put = (k: string, v?: string | number | boolean | null) => {
    if (v == null || v === "" || v === false) return;
    aspects[k] = [String(v)];
  };
  put("Year", asset.year);
  put("Set", asset.setName);
  put("Player/Subject", asset.playerSubject);
  put("Team", asset.team);
  put("Card Number", asset.cardNumber);
  put("Parallel/Variety", asset.parallel);
  put("Sport", asset.sport);
  put("Manufacturer", asset.manufacturer);
  put("Graded", asset.grader ? "Yes" : "No");
  put("Professional Grader", asset.grader);
  put("Grade", asset.grade);
  put("Features", asset.rookieFlag ? "Rookie" : null);
  return aspects;
}
