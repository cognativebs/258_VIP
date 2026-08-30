import { markInferred } from "@vip/evidence";
import type { IdentityCandidate } from "./schemas.js";

export const SPORTS_PARSE_RULE = "sports-identity-parse@0.2.0";

const MANUFACTURERS: Array<{ token: string; label: string }> = [
  { token: "upper deck", label: "Upper Deck" },
  { token: "panini", label: "Panini" },
  { token: "topps", label: "Topps" },
  { token: "leaf", label: "Leaf" },
  { token: "fleer", label: "Fleer" },
];

const BRANDS: Array<{ token: string; label: string }> = [
  { token: "upper deck", label: "Upper Deck" },
  { token: "stadium club", label: "Stadium Club" },
  { token: "panini prizm", label: "Panini Prizm" },
  { token: "topps chrome", label: "Topps Chrome" },
  { token: "contenders", label: "Contenders" },
  { token: "chronicles", label: "Chronicles" },
  { token: "donruss", label: "Donruss" },
  { token: "prizm", label: "Prizm" },
  { token: "bowman", label: "Bowman" },
  { token: "select", label: "Select" },
  { token: "mosaic", label: "Mosaic" },
  { token: "optic", label: "Optic" },
  { token: "heritage", label: "Heritage" },
  { token: "finest", label: "Finest" },
  { token: "hoops", label: "Hoops" },
  { token: "score", label: "Score" },
  { token: "phoenix", label: "Phoenix" },
  { token: "absolute", label: "Absolute" },
  { token: "prestige", label: "Prestige" },
  { token: "playoff", label: "Playoff" },
  { token: "topps", label: "Topps" },
  { token: "panini", label: "Panini" },
  { token: "fleer", label: "Fleer" },
];

const STOP = new Set([
  "front",
  "back",
  "jpg",
  "jpeg",
  "png",
  "tif",
  "tiff",
  "card",
  "cards",
  "rookie",
  "holo",
  "auto",
  "autograph",
  "psa",
  "bgs",
  "cgc",
  "rc",
  "the",
  "and",
  "parallel",
  "numbered",
  "relic",
  "patch",
  "serial",
  "die",
  "cut",
  "rated",
  "ticket",
  "football",
  "footbal",
  "basketball",
  "baseball",
  "hockey",
  "soccer",
  "copyright",
  "llc",
  "inc",
  "official",
  "trading",
  "made",
  "china",
  "usa",
  "limited",
  "edition",
  "nfl",
  "nba",
  "mlb",
  "nhl",
  "ncaa",
  "product",
  "www",
  "com",
  "no",
  "img",
  "image",
  "scan",
  "doc",
  "america",
  "licensed",
  "printed",
  "reserved",
  "trademark",
  "collectible",
  "collectibles",
  "rights",
  "all",
  "this",
  "that",
  "from",
  "with",
  "for",
  "your",
  "their",
]);

const PARALLELS: Array<{ token: string; label: string }> = [
  { token: "pink ice", label: "Pink Ice" },
  { token: "pink camo", label: "Pink Camo" },
  { token: "red white blue", label: "Red White Blue" },
  { token: "tie dye", label: "Tie-Dye" },
  { token: "tiger stripe", label: "Tiger Stripe" },
  { token: "green shimmer", label: "Green Shimmer" },
  { token: "orange disco", label: "Orange Disco" },
  { token: "green scope", label: "Green Scope" },
  { token: "fast break", label: "Fast Break" },
  { token: "club level", label: "Club Level" },
  { token: "die cut", label: "Die-Cut" },
  { token: "downtown", label: "Downtown" },
  { token: "genesis", label: "Genesis" },
  { token: "courtside", label: "Courtside" },
  { token: "silver", label: "Silver" },
  { token: "gold", label: "Gold" },
  { token: "choice", label: "Choice" },
];

export type SportsParsedIdentity = {
  year: number | null;
  manufacturer: string | null;
  brand: string | null;
  player: string | null;
  collectorNumber: string | null;
  parallel: string | null;
  serialMax: number | null;
  autograph: boolean;
  relic: boolean;
  displayName: string;
  setName: string | null;
  confidence: number;
  matchReasons: string[];
  numberFromLabel: boolean;
};

export function parseSportsIdentity(raw: string): SportsParsedIdentity | null {
  const text = normalize(raw);
  if (!text) return null;

  const yearMatch = text.match(/\b((?:19|20)\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  let manufacturer: string | null = null;
  for (const m of MANUFACTURERS) {
    if (text.includes(m.token)) {
      manufacturer = m.label;
      break;
    }
  }

  let brand: string | null = null;
  for (const b of BRANDS) {
    if (text.includes(b.token)) {
      brand = b.label;
      break;
    }
  }

  const autograph = /\b(auto|autograph)\b/.test(text);
  const relic = /\b(relic|patch)\b/.test(text);

  let parallel: string | null = null;
  for (const p of PARALLELS) {
    if (text.includes(p.token)) {
      parallel = p.label;
      break;
    }
  }

  const serialMatch = text.match(/\/\s*(\d{1,3})\b/) ?? text.match(/\bnumbered\s+(\d{1,3})\b/);
  const serialMax = serialMatch ? Number(serialMatch[1]) : null;

  const labeledNum =
    text.match(/\bno\.?\s*(\d{1,4}[a-z]?)\b/) ??
    text.match(/#\s*(\d{1,4}[a-z-]{0,8})\b/) ??
    text.match(/\bcard\s+(?:no\.?\s*)?(\d{1,4})\b/);
  const otherNums = [...text.matchAll(/\b(\d{1,4})\b/g)]
    .map((m) => m[1]!)
    .filter((n) => !(year && n === String(year)))
    .filter((n) => !(serialMax && n === String(serialMax)));
  const collectorNumber = labeledNum?.[1] ?? otherNums[0] ?? null;
  const numberFromLabel = Boolean(labeledNum?.[1]);

  const stripped = text
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\bno\.?\s*\d{1,4}[a-z]?\b/g, " ")
    .replace(/#\s*\d{1,4}[a-z-]{0,8}\b/gi, " ")
    .replace(/\/\s*\d{1,3}\b/g, " ");
  let remainder = stripped;
  if (brand) remainder = remainder.replace(normalize(brand), " ");
  if (manufacturer) remainder = remainder.replace(normalize(manufacturer), " ");
  for (const b of BRANDS) remainder = remainder.replace(b.token, " ");
  for (const m of MANUFACTURERS) remainder = remainder.replace(m.token, " ");
  if (parallel) remainder = remainder.replace(normalize(parallel), " ");
  for (const p of PARALLELS) remainder = remainder.replace(p.token, " ");

  const playerTokens = remainder
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
  const player = playerTokens.length ? titleCase(playerTokens.slice(0, 4).join(" ")) : null;

  if (!year && !brand && !manufacturer) return null;
  if (!player && !collectorNumber) return null;

  const reasons: string[] = [];
  if (year) reasons.push(`year:${year}`);
  if (manufacturer) reasons.push(`manufacturer:${manufacturer}`);
  if (brand) reasons.push(`brand:${brand}`);
  if (player) reasons.push(`player:${player}`);
  if (collectorNumber) reasons.push(`collector_number:${collectorNumber}`);
  if (parallel) reasons.push(`parallel:${parallel}`);
  if (serialMax) reasons.push(`serial:/${serialMax}`);
  if (autograph) reasons.push("autograph");
  if (relic) reasons.push("relic");

  const playerWords = player ? player.split(/\s+/).length : 0;
  const completeBase = Boolean(
    year && (brand || manufacturer) && playerWords >= 2 && collectorNumber,
  );

  let confidence = 0.2;
  if (year) confidence += 0.15;
  if (brand || manufacturer) confidence += 0.15;
  if (player) confidence += playerWords >= 2 ? 0.22 : 0.12;
  if (collectorNumber) confidence += numberFromLabel ? 0.16 : 0.12;
  if (completeBase && numberFromLabel) {
    confidence = Math.min(0.86, Number(confidence.toFixed(3)));
  } else {
    confidence = Math.min(0.72, Number(confidence.toFixed(3)));
  }

  const brandHasMfr =
    Boolean(brand && manufacturer && normalize(brand).includes(normalize(manufacturer)));
  const setName =
    [year, !brandHasMfr && manufacturer && manufacturer !== brand ? manufacturer : null, brand]
      .filter(Boolean)
      .join(" ") || null;
  const displayName = [
    year,
    !brandHasMfr && manufacturer && manufacturer !== brand ? manufacturer : null,
    brand,
    player,
    collectorNumber && `#${collectorNumber}`,
    parallel,
    serialMax && `/${serialMax}`,
    autograph ? "Auto" : null,
    relic ? "Relic" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    year,
    manufacturer,
    brand,
    player,
    collectorNumber,
    parallel,
    serialMax,
    autograph,
    relic,
    displayName: displayName || "Sports card (parsed · unverified)",
    setName,
    confidence,
    matchReasons: reasons,
    numberFromLabel,
  };
}

export function sportsParsedCandidate(raw: string): IdentityCandidate | null {
  const parsed = parseSportsIdentity(raw);
  if (!parsed) return null;
  const keyParts = [
    "sports",
    "parsed",
    parsed.year ?? "year",
    (parsed.brand ?? parsed.manufacturer ?? "brand").toLowerCase().replace(/\s+/g, "-"),
    (parsed.player ?? "player").toLowerCase().replace(/\s+/g, "-"),
    parsed.collectorNumber ?? "n",
  ];
  return {
    assetId: null,
    catalogKey: keyParts.join(":"),
    category: "sports",
    displayName: parsed.displayName,
    setName: parsed.setName,
    collectorNumber: parsed.collectorNumber,
    playerOrCharacter: parsed.player,
    year: parsed.year,
    externalIds: [
      { source: "sports_parsed", value: keyParts.slice(2).join("-") },
    ],
    confidence: parsed.confidence,
    matchReasons: parsed.matchReasons,
    provenance: markInferred({
      source: "sports_identity_parse",
      ruleOrModelVersion: SPORTS_PARSE_RULE,
      confidence: parsed.confidence,
      notes:
        "Parsed year/brand/player/number from image OCR or filename · unverified until operator confirm.",
    }),
  };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9/#.\s-]+/g, " ")
    .replace(/[_./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
