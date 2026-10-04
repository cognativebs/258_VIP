/** CLZ-shaped comic row used by the terminal (comics API or VIP inventory map). */

export type ComicRow = {
  id: string;
  Series?: string;
  Issue?: string;
  "Issue Full"?: string;
  Title?: string;
  "Edition / Variant"?: string;
  Publisher?: string;
  "Collection Pillar"?: string;
  "Inventory Bucket"?: string;
  "Inventory Bucket Source"?: string;
  "Live Range"?: string | null;
  "Live Low"?: number | null;
  "Live High"?: number | null;
  "Live Listings"?: number | null;
  "Current Price"?: number | null;
  "Cover Price"?: number | null;
  "Purchase Price"?: number | null;
  "Museum Score"?: number | null;
  "Investment Score"?: number | null;
  "Liquidity Score"?: number | null;
  Recommendation?: string | null;
  "Sell Priority"?: string | null;
  Location?: string | null;
  Quantity?: number | null;
  Duplicate?: string | null;
  "Needs Grading"?: string | null;
  "Needs Photo"?: string | null;
  "Needs Verification"?: string | null;
  "Upgrade Candidate"?: string | null;
  "Is Key Comic"?: string | null;
  "Key Comic Reason"?: string | null;
  "Key Categories"?: string | null;
  "Slab Status"?: string | null;
  "Assumed Grade"?: string | null;
  "Grade Rating"?: number | null;
  "Verification Notes"?: string | null;
  Barcode?: string | null;
  Tags?: string | null;
  [key: string]: unknown;
};

export type UnknownExitRecommendation = {
  action: string;
  appliesTo: string;
  reasonCodes: string[];
  confidence: number;
  notes: string;
};

export type UnknownExitImpact = {
  catalogHoldings: number;
  catalogValue: number;
  scopeName: string;
  scopeHoldings: number;
  scopeValue: number;
  estimatedQty: number;
  giftedShare: number;
  unaccountedValueHigh: number;
  physicalHoldingsLow: number;
  physicalHoldingsHigh: number;
  physicalValueLow: number;
  physicalValueHigh: number;
  holdingsTouched: boolean;
  titlesInvented: boolean;
  verificationStatus: string;
  method: string;
  ruleOrModelVersion: string;
  recommendations: UnknownExitRecommendation[];
};

export type UnknownExitEvent = {
  id: string;
  estimatedQty: number;
  titlesRecorded: boolean;
  holdingsTouched: boolean;
  recipientNote?: string | null;
  status: string;
  occurredAt?: string;
};

export type UnknownExitPayload = {
  event: UnknownExitEvent | null;
  impact: UnknownExitImpact | null;
  catalog?: {
    catalogHoldings: number;
    catalogValue: number;
    scopeName: string;
    scopeHoldings: number;
    scopeValue: number;
  };
};

export type ComicsMeta = {
  recordCount?: number;
  totalValue?: number;
  museumCandidates?: number;
  pillars?: { name: string; count: number; value?: number }[];
  locations?: string[];
  source?: string;
  /** Identity of the immutable CLZ import behind these rows, when known. */
  snapshotLabel?: string;
  unknownExit?: UnknownExitPayload;
  physicalValueLow?: number;
  physicalValueHigh?: number;
  physicalValueLabel?: string;
};

export type ComicFilters = {
  query: string;
  pillar: string;
  bucket: string;
  location: string;
  publisher: string;
  slabStatus: string;
  sellPriority: string;
  keyOnly: boolean;
  duplicateOnly: boolean;
  needsGrading: boolean;
  upgradeOnly: boolean;
  recommendations: string[];
  minPrice: string;
  maxPrice: string;
  minMuseum: number;
  minInvestment: number;
  minLiquidity: number;
};
