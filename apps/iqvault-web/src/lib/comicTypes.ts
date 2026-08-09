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

export type ComicsMeta = {
  recordCount?: number;
  totalValue?: number;
  museumCandidates?: number;
  pillars?: { name: string; count: number }[];
  locations?: string[];
  source?: string;
};

export type ComicFilters = {
  query: string;
  pillar: string;
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
