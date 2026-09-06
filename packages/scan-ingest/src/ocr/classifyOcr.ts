/**
 * OCR is evidence, not identity. Classify lines so biography/stats never
 * become the player name, and unlabeled numbers never become the card number.
 */

export type OcrRegionKind =
  | "card_number"
  | "title"
  | "copyright"
  | "product"
  | "logo"
  | "body"
  | "unknown";

export type OcrSpan = {
  text: string;
  kind: OcrRegionKind;
  bbox: { x: number; y: number; w: number; h: number } | null;
  confidence: number | null;
};

export type StructuredOcrExtract = {
  player: string | null;
  year: number | null;
  manufacturer: string | null;
  brand: string | null;
  set: string | null;
  number: string | null;
  /** Kinds that contributed a field — for debug. */
  usedKinds: OcrRegionKind[];
};

const BODY_MARKERS =
  /\b(brought|season|career|drafted|selected|traded|signed|passed|rushed|yards?|touchdowns?|points|average|record|led the|in his|during the|after the|before the|rookie year|pro bowl|all[- ]pro|super bowl)\b/i;

const COPYRIGHT_MARKERS =
  /\b(copyright|©|\(c\)|llc|inc\.|panini america|topps company|the pokemon company|wizards of the coast|upper deck)\b/i;

const PRODUCT_TOKENS =
  /\b(panini|topps|donruss|prizm|select|optic|mosaic|bowman|fleer|score|upper\s*deck|leaf|sage|chronicles|contenders|certified|absolute|phoenix|zenith|prestige|playoff|limited|national\s+treasures|one\s+and\s+one|flawless|impeccable|encased|obsidian|spectra|revolution|illusions|hoops|stickers|pokemon|magic|mtg|yugioh)\b/i;

const LABELED_NUMBER = /(?:no\.?|#)\s*([A-Za-z]{0,4}\d{1,4}(?:[A-Za-z]\d?)?)\b/i;

const YEAR_TOKEN = /\b((?:19|20)\d{2})\b/;

const SPORT_STOP = new Set([
  "football",
  "basketball",
  "baseball",
  "hockey",
  "soccer",
  "card",
  "cards",
  "rookie",
  "official",
  "trading",
]);

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function letterTokens(text: string, minLen: number): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter((w) => w.length >= minLen);
}

function nameTokens(text: string): string[] {
  const tokens = letterTokens(text, 1);
  return tokens.some((w) => w.length >= 3) ? tokens : [];
}

export function classifyOcrLine(text: string): OcrRegionKind {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "unknown";
  const words = wordCount(t);

  if (COPYRIGHT_MARKERS.test(t)) return "copyright";
  if (LABELED_NUMBER.test(t) && words <= 8) return "card_number";
  if (PRODUCT_TOKENS.test(t) && words <= 10) return "product";
  if (BODY_MARKERS.test(t) || words >= 8) return "body";
  if (looksLikePlayerTitle(t)) return "title";
  return "unknown";
}

function looksLikePlayerTitle(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 3) return false;
  if (PRODUCT_TOKENS.test(text) || BODY_MARKERS.test(text) || COPYRIGHT_MARKERS.test(text)) {
    return false;
  }
  if (/\d/.test(text) && !/\b(jr|sr|ii|iii|iv)\b/i.test(text)) return false;
  const letters = words.map((w) => w.replace(/[^A-Za-z]/g, ""));
  if (letters.some((w) => w.length === 0)) return false;
  if (!letters.some((w) => w.length >= 3)) return false;
  return letters.filter((w) => w.length === 1).length <= 2;
}

export function classifyOcrSpans(
  lines: Array<{
    text: string;
    bbox?: { x: number; y: number; w: number; h: number } | null;
    confidence?: number | null;
  }>,
): OcrSpan[] {
  return lines
    .map((line) => {
      const text = line.text.replace(/\s+/g, " ").trim();
      return {
        text,
        kind: classifyOcrLine(text),
        bbox: line.bbox ?? null,
        confidence: line.confidence ?? null,
      };
    })
    .filter((s) => s.text.length > 0);
}

function firstYear(spans: OcrSpan[]): number | null {
  for (const span of spans) {
    const m = span.text.match(YEAR_TOKEN);
    if (m) {
      const y = Number(m[1]);
      if (y >= 1933 && y <= 2035) return y;
    }
  }
  return null;
}

function firstLabeledNumber(spans: OcrSpan[]): string | null {
  for (const span of spans) {
    const m = span.text.match(LABELED_NUMBER);
    if (m?.[1]) return m[1].toUpperCase();
  }
  return null;
}

function titleCaseName(words: string[]): string {
  return words
    .map((w) =>
      w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
}

function productTokens(text: string): {
  manufacturer: string | null;
  brand: string | null;
} {
  const lower = text.toLowerCase();
  let manufacturer: string | null = null;
  let brand: string | null = null;
  if (/\bpanini\b/.test(lower)) manufacturer = "Panini";
  if (/\btopps\b/.test(lower)) manufacturer = manufacturer ?? "Topps";
  if (/\bupper\s*deck\b/.test(lower)) manufacturer = manufacturer ?? "Upper Deck";
  if (/\bfleer\b/.test(lower)) manufacturer = manufacturer ?? "Fleer";
  if (/\bdonruss\b/.test(lower)) brand = "Donruss";
  if (/\bprizm\b/.test(lower)) brand = brand ?? "Prizm";
  if (/\bselect\b/.test(lower)) brand = brand ?? "Select";
  if (/\boptic\b/.test(lower)) brand = brand ?? "Optic";
  if (/\bmosaic\b/.test(lower)) brand = brand ?? "Mosaic";
  if (/\bbowman\b/.test(lower)) brand = brand ?? "Bowman";
  if (/\bscore\b/.test(lower)) brand = brand ?? "Score";
  if (/\bhoops\b/.test(lower)) brand = brand ?? "Hoops";
  if (/\bcontenders\b/.test(lower)) brand = brand ?? "Contenders";
  if (/\bchrome\b/.test(lower)) brand = brand ?? "Chrome";
  if (manufacturer && !brand) brand = manufacturer;
  return { manufacturer, brand };
}

function stripKnownProduct(text: string): string {
  return text
    .replace(YEAR_TOKEN, " ")
    .replace(LABELED_NUMBER, " ")
    .replace(/\b\d{1,4}\b/g, " ")
    .replace(
      /\b(panini|topps|donruss|prizm|select|optic|mosaic|bowman|fleer|score|upper\s*deck|leaf|llc|inc\.|america|company|copyright|©|chrome|contenders|football|basketball|baseball|hockey|soccer)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function nameFromRemainder(text: string): string | null {
  if (BODY_MARKERS.test(text)) return null;
  const leftover = stripKnownProduct(text);
  if (!leftover || BODY_MARKERS.test(leftover)) return null;
  const words = leftover.split(/\s+/).filter(Boolean);
  if (!looksLikePlayerTitle(leftover)) return null;
  return titleCaseName(nameTokens(leftover));
}

function unlabeledNumberAfterIdentity(text: string, player: string | null): string | null {
  if (LABELED_NUMBER.test(text)) return null;
  let rest = text.replace(YEAR_TOKEN, " ");
  if (player) {
    rest = rest.replace(new RegExp(player.replace(/\s+/g, "\\s+"), "i"), " ");
  }
  rest = rest.replace(
    /\b(panini|topps|donruss|prizm|select|optic|mosaic|bowman|fleer|score|upper\s*deck|leaf|llc|inc\.|america|company|copyright|chrome|contenders|football|basketball|baseball|hockey|soccer)\b/gi,
    " ",
  );
  const nums = [...rest.matchAll(/\b(\d{1,4})\b/g)].map((m) => m[1]!);
  if (nums.length === 1) return nums[0]!.toUpperCase();
  return null;
}

/**
 * Product/copyright lines may yield year/brand/set/mfr — player only when the
 * leftover after stripping those tokens is a 2–3 word name.
 */
function productFields(spans: OcrSpan[]): Pick<
  StructuredOcrExtract,
  "year" | "manufacturer" | "brand" | "set" | "player" | "number"
> {
  const text = spans.map((s) => s.text).join(" ");
  const { manufacturer, brand } = productTokens(text);
  const player = nameFromRemainder(text);
  const setBits = stripKnownProduct(text);
  const setOk =
    Boolean(setBits) &&
    setBits.length >= 3 &&
    setBits.length <= 32 &&
    wordCount(setBits) <= 3 &&
    !looksLikePlayerTitle(setBits) &&
    !BODY_MARKERS.test(setBits);
  const set = setOk
    ? setBits.replace(/\b\w/g, (c) => c.toUpperCase())
    : brand ?? manufacturer;
  return {
    year: firstYear(spans),
    manufacturer,
    brand,
    set: set ?? null,
    player,
    number: unlabeledNumberAfterIdentity(text, player),
  };
}

function titlePlayer(spans: OcrSpan[]): string | null {
  for (const span of spans) {
    if (looksLikePlayerTitle(span.text)) {
      return titleCaseName(nameTokens(span.text));
    }
  }
  return null;
}

export function extractStructuredFromOcr(spans: OcrSpan[]): StructuredOcrExtract {
  const privileged = spans.filter((s) =>
    ["card_number", "title", "copyright", "product", "logo"].includes(s.kind),
  );
  const usedKinds = [...new Set(privileged.map((s) => s.kind))];
  const product = productFields(
    privileged.filter((s) =>
      ["product", "copyright", "card_number"].includes(s.kind),
    ),
  );
  const player =
    titlePlayer(privileged.filter((s) => s.kind === "title")) ?? product.player;
  return {
    player,
    year: product.year ?? firstYear(privileged),
    manufacturer: product.manufacturer,
    brand: product.brand,
    set: product.set,
    number:
      firstLabeledNumber(privileged.filter((s) => s.kind === "card_number")) ??
      product.number,
    usedKinds,
  };
}

export function privilegedOcrIsComplete(extract: StructuredOcrExtract): boolean {
  return Boolean(
    extract.player &&
      extract.year &&
      extract.number &&
      (extract.manufacturer || extract.brand || extract.set),
  );
}

export function spansFromTextBlock(text: string): OcrSpan[] {
  return classifyOcrSpans(
    text
      .split(/\r?\n/)
      .map((line) => ({ text: line }))
      .filter((l) => l.text.trim().length > 0),
  );
}

export { SPORT_STOP };
