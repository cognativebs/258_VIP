// Mock catalog aligned with vault_core + category schemas in ../0*.sql

import { assetToCardSignals, computeCardOffer } from "../lib/offerEngine.js";

export const CATEGORIES = [
  { id: 1, kind: "pokemon", display_name: "Pokémon TCG", icon: "⚡", color: "#fbbf24" },
  { id: 2, kind: "sports", display_name: "Sports Cards", icon: "🏈", color: "#3b82f6" },
  { id: 3, kind: "mtg", display_name: "Magic: The Gathering", icon: "🔮", color: "#a855f7" },
  { id: 4, kind: "comic", display_name: "Comic Books", icon: "📚", color: "#ef4444" },
];

export const GRADING = [
  { id: 0, code: "RAW", name: "Ungraded / Raw" },
  { id: 1, code: "PSA", name: "Professional Sports Authenticator" },
  { id: 2, code: "CGC", name: "Certified Guaranty Company" },
];

export const GRADE_SCALES = {
  raw: { label: "Raw NM", normalized: 75 },
  psa10: { label: "PSA GEM MT 10", normalized: 100 },
  psa9: { label: "PSA MINT 9", normalized: 90 },
  cgc98: { label: "CGC 9.8", normalized: 98 },
};

export const ASSETS = [
  {
    id: "a1-pkmn-charizard-sar",
    category: "pokemon",
    canonical_name: "Charizard ex — Special Illustration Rare",
    slug: "sv151-charizard-ex-sar",
    release_year: 2023,
    tags: ["chase", "illustration_rare"],
    set: "Scarlet & Violet 151",
    collector_number: "199/165",
    variant_type: "special_illustration_rare",
    rarity: "Special Illustration Rare",
    base_asset_id: null,
    parallels: ["normal", "reverse_holo", "special_illustration_rare"],
    external_ids: [
      { source: "tcgplayer", value: "519224" },
      { source: "pokemontcgio", value: "sv3pt5-199" },
    ],
    market: {
      raw: { price: 142.5, trend_30d: 8.2, velocity: "fast", liquidity: 88, sample_size: 47 },
      psa10: { price: 385.0, trend_30d: 11.0, velocity: "medium", liquidity: 72, sample_size: 12 },
    },
    pop: { psa10: 1842, psa9: 3201 },
    image: "🐉",
  },
  {
    id: "a2-sports-mclaurin-silver",
    category: "sports",
    canonical_name: "2019 Panini Prizm Terry McLaurin Silver Prizm RC",
    slug: "2019-prizm-mclaurin-301-silver",
    release_year: 2019,
    tags: ["rookie", "prizm", "silver"],
    product: "2019 Panini Prizm Football",
    subset: "Base",
    parallel_ladder: ["Base", "Silver", "Red", "Blue", "Green", "Gold", "Black"],
    player_name: "Terry McLaurin",
    card_number: "301",
    is_rookie: true,
    parallel_type: "Silver",
    print_run: null,
    base_asset_id: "a2-sports-mclaurin-base",
    external_ids: [{ source: "130point", value: "mclaurin-301-silver" }],
    market: {
      raw: { price: 89.0, trend_30d: -3.1, velocity: "medium", liquidity: 65, sample_size: 28 },
      psa10: { price: 425.0, trend_30d: 5.4, velocity: "slow", liquidity: 41, sample_size: 9 },
    },
    pop: { psa10: 412, psa9: 891 },
    image: "🏈",
  },
  {
    id: "a2-sports-mclaurin-base",
    category: "sports",
    canonical_name: "2019 Panini Prizm Terry McLaurin Base RC",
    slug: "2019-prizm-mclaurin-301-base",
    release_year: 2019,
    tags: ["rookie", "prizm", "base"],
    product: "2019 Panini Prizm Football",
    subset: "Base",
    parallel_ladder: ["Base", "Silver", "Red", "Blue", "Green", "Gold", "Black"],
    player_name: "Terry McLaurin",
    card_number: "301",
    is_rookie: true,
    parallel_type: "Base",
    print_run: null,
    base_asset_id: null,
    market: {
      raw: { price: 12.0, trend_30d: 1.2, velocity: "fast", liquidity: 90, sample_size: 120 },
      psa10: { price: 85.0, trend_30d: 2.0, velocity: "medium", liquidity: 70, sample_size: 35 },
    },
    pop: { psa10: 2104, psa9: 4521 },
    image: "🏈",
  },
  {
    id: "a3-sports-mclaurin-ruby",
    category: "sports",
    canonical_name: "2019 Panini Prizm Terry McLaurin Ruby /25 RC",
    slug: "2019-prizm-mclaurin-301-ruby",
    release_year: 2019,
    tags: ["rookie", "prizm", "ruby", "numbered"],
    product: "2019 Panini Prizm Football",
    subset: "Base",
    parallel_ladder: ["Base", "Silver", "Red", "Blue", "Green", "Gold", "Black"],
    player_name: "Terry McLaurin",
    card_number: "301",
    is_rookie: true,
    parallel_type: "Ruby",
    print_run: 25,
    base_asset_id: "a2-sports-mclaurin-base",
    market: {
      raw: { price: 1200.0, trend_30d: 14.2, velocity: "slow", liquidity: 22, sample_size: 4 },
      psa10: { price: 2800.0, trend_30d: 18.0, velocity: "slow", liquidity: 15, sample_size: 2 },
    },
    pop: { psa10: 8, psa9: 14 },
    image: "💎",
  },
  {
    id: "a4-mtg-serialized",
    category: "mtg",
    canonical_name: "The One Ring — Serialized Borderless",
    slug: "ltr-one-ring-serialized",
    release_year: 2023,
    tags: ["serialized", "chase", "universes_beyond"],
    set: "The Lord of the Rings: Tales of Middle-earth",
    collector_number: "246",
    variant_type: "serialized",
    finish: "foil",
    serial_max: 150,
    is_serialized: true,
    base_asset_id: "a4-mtg-one-ring-normal",
    external_ids: [{ source: "scryfall", value: "ltr-246" }],
    market: {
      raw: { price: 18500.0, trend_30d: -2.0, velocity: "slow", liquidity: 35, sample_size: 6 },
    },
    image: "💍",
  },
  {
    id: "a5-comic-batman-1a",
    category: "comic",
    canonical_name: "Absolute Batman #1 — Cover A (1st Printing)",
    slug: "absolute-batman-1-cover-a-1st",
    release_year: 2024,
    tags: ["key_issue", "1st_print"],
    series: "Absolute Batman",
    publisher: "DC Comics",
    issue_number: "1",
    printing: 1,
    cover_label: "A",
    cover_artist: "Nick Dragotta",
    is_key_issue: true,
    key_reason: "Series launch — high demand across printings",
    printings_available: 11,
    external_ids: [{ source: "gcd", value: "abs-batman-1-a-1" }],
    market: {
      raw: { price: 12.5, trend_30d: -18.0, velocity: "fast", liquidity: 92, sample_size: 156 },
      cgc98: { price: 45.0, trend_30d: -8.0, velocity: "medium", liquidity: 58, sample_size: 22 },
    },
    image: "🦇",
  },
  {
    id: "a5-comic-batman-1a-p3",
    category: "comic",
    canonical_name: "Absolute Batman #1 — Cover A (3rd Printing)",
    slug: "absolute-batman-1-cover-a-3rd",
    release_year: 2024,
    tags: ["key_issue", "3rd_print"],
    series: "Absolute Batman",
    publisher: "DC Comics",
    issue_number: "1",
    printing: 3,
    cover_label: "A",
    cover_artist: "Nick Dragotta",
    is_key_issue: false,
    base_asset_id: "a5-comic-batman-1a",
    printings_available: 11,
    external_ids: [{ source: "gcd", value: "abs-batman-1-a-3" }],
    market: {
      raw: { price: 5.0, trend_30d: -5.0, velocity: "medium", liquidity: 75, sample_size: 42 },
    },
    image: "🦇",
  },
  {
    id: "a6-sealed-etb",
    category: "pokemon",
    format: "sealed_product",
    canonical_name: "Scarlet & Violet 151 Elite Trainer Box",
    slug: "sv151-etb",
    release_year: 2023,
    tags: ["sealed", "etb"],
    product_type: "etb",
    pack_count: 9,
    msrp: 49.99,
    estimated_ev: 62.0,
    market: {
      raw: { price: 78.0, trend_30d: 3.5, velocity: "fast", liquidity: 85, sample_size: 89 },
    },
    image: "📦",
  },
];

export const ID_OBSERVATIONS = [
  {
    id: 101,
    image_url: "scan_001.jpg",
    ocr_text: "301 McLAURIN PRIZM 2019",
    predicted_asset_id: "a2-sports-mclaurin-silver",
    predicted_confidence: 0.72,
    confirmed_asset_id: null,
    capture_frames: 3,
    store_id: "store-demo-001",
    created_at: "2026-06-29T14:22:00Z",
    candidates: [
      { asset_id: "a2-sports-mclaurin-silver", confidence: 0.72, reason: "OCR match + Prizm foil pattern" },
      { asset_id: "a3-sports-mclaurin-ruby", confidence: 0.18, reason: "Same player/number, red foil detected" },
      { asset_id: "a2-sports-mclaurin-base", confidence: 0.10, reason: "Base parallel fallback" },
    ],
  },
  {
    id: 102,
    image_url: "scan_002.jpg",
    ocr_text: "199/165 CHARIZARD ex",
    predicted_asset_id: "a1-pkmn-charizard-sar",
    predicted_confidence: 0.94,
    confirmed_asset_id: "a1-pkmn-charizard-sar",
    was_correct: true,
    capture_frames: 1,
    store_id: "store-demo-001",
    created_at: "2026-06-29T13:05:00Z",
  },
  {
    id: 103,
    image_url: "scan_003.jpg",
    ocr_text: "ABSOLUTE BATMAN 1",
    predicted_asset_id: "a5-comic-batman-1a",
    predicted_confidence: 0.61,
    confirmed_asset_id: null,
    capture_frames: 2,
    store_id: "store-demo-002",
    created_at: "2026-06-29T12:40:00Z",
    candidates: [
      { asset_id: "a5-comic-batman-1a", confidence: 0.61, reason: "Cover A art match, logo color = 1st print" },
      { asset_id: "a5-comic-batman-1a-p3", confidence: 0.28, reason: "Same cover, recolored logo (3rd print)" },
    ],
  },
];

export const SCAN_SCENARIOS = [
  {
    id: "sports-parallel",
    label: "Sports Parallel Disambiguation",
    description: "2019 Prizm McLaurin — Silver vs Ruby",
    ocr: "301 McLAURIN PRIZM 2019",
    frames: [
      { stage: "Capture", detail: "3 frames captured — front tilt for foil fingerprint" },
      { stage: "OCR", detail: "301 · McLAURIN · PRIZM · 2019" },
      { stage: "Category", detail: "Sports Cards → 2019 Panini Prizm Football" },
      { stage: "Subset Lock", detail: "Base subset · parallel ladder: 7 tiers" },
      { stage: "Disambiguation", detail: "Foil pattern: prizm silver (not ruby red)" },
    ],
    result: "a2-sports-mclaurin-silver",
    confidence: 0.89,
    alternates: ["a3-sports-mclaurin-ruby"],
  },
  {
    id: "pokemon-sar",
    label: "Pokémon SAR Identification",
    description: "SV151 Charizard ex Special Illustration Rare",
    ocr: "199/165 CHARIZARD ex",
    frames: [
      { stage: "Capture", detail: "1 frame — high-res collector number visible" },
      { stage: "OCR", detail: "199/165 · CHARIZARD ex" },
      { stage: "Category", detail: "Pokémon TCG → Scarlet & Violet 151" },
      { stage: "Variant", detail: "Special Illustration Rare (etched full-art)" },
    ],
    result: "a1-pkmn-charizard-sar",
    confidence: 0.96,
    alternates: [],
  },
  {
    id: "comic-printing",
    label: "Comic Printing Detection",
    description: "Absolute Batman #1 — 1st vs 3rd printing",
    ocr: "ABSOLUTE BATMAN 1",
    frames: [
      { stage: "Capture", detail: "2 frames — cover + spine/logo color" },
      { stage: "OCR", detail: "ABSOLUTE BATMAN · #1" },
      { stage: "Category", detail: "Comics → Absolute Batman (DC, 2024)" },
      { stage: "Cover", detail: "Cover A — Nick Dragotta" },
      { stage: "Printing", detail: "Logo color analysis → 1st printing" },
    ],
    result: "a5-comic-batman-1a",
    confidence: 0.78,
    alternates: [],
  },
];

export function getAsset(id) {
  return ASSETS.find((a) => a.id === id);
}

export function getCategory(kind) {
  return CATEGORIES.find((c) => c.kind === kind);
}

export function computeVaultScore(asset, gradeKey = "raw") {
  const m = asset.market[gradeKey] || asset.market.raw;
  if (!m) return null;
  const trendScore = Math.min(100, Math.max(0, 50 + m.trend_30d * 2));
  const liquidityScore = m.liquidity;
  const popPenalty = asset.pop?.psa10 && asset.pop.psa10 > 5000 ? 15 : 0;
  const velocityBonus = m.velocity === "fast" ? 10 : m.velocity === "medium" ? 5 : 0;
  const score = Math.round(
    trendScore * 0.25 + liquidityScore * 0.35 + (100 - popPenalty) * 0.25 + velocityBonus * 0.15
  );
  return Math.min(100, Math.max(0, score));
}

export function computeOffer(asset, gradeKey = "raw") {
  const card = assetToCardSignals(asset, gradeKey);
  if (!card) return null;
  const offer = computeCardOffer(card);
  const vaultScore = computeVaultScore(asset, gradeKey);
  const effectivePct = card.marketValue > 0 ? offer.recommended / card.marketValue : 0;
  return {
    cashOffer: offer.recommended,
    maxOffer: offer.maximum,
    marketPrice: card.marketValue,
    vaultScore,
    tier: offer.tier,
    buyPct: offer.buyPct,
    avoid: offer.avoid,
    avoidReason: offer.avoidReason,
    effectivePct,
  };
}

export function formatCurrency(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function formatPct(n) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}
