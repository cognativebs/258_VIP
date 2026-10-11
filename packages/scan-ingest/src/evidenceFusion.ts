import {
  field,
  unknownField,
  type CardIdentityEvidence,
  type CardIdentityFields,
  type EvidenceField,
  type EvidenceOrigin,
} from "@vip/core-model";
import type { StructuredOcrExtract } from "./ocr/classifyOcr.js";
import {
  isSportsStopToken,
  parseSportsIdentity,
  type SportsParsedIdentity,
} from "./sportsIdentity.js";

const OCR_FIELD_CONFIDENCE = 0.68;

function fromParsed(
  parsed: SportsParsedIdentity | null,
  origin: EvidenceOrigin,
  extra: Partial<Record<keyof CardIdentityFields, EvidenceField>> = {},
): CardIdentityFields {
  const c = parsed ? parsed.confidence : 0;
  const empty = unknownField(origin);
  return {
    category: parsed ? field("sports", 0.5, origin) : empty,
    playerOrCharacter: parsed?.player
      ? field(parsed.player, c, origin)
      : empty,
    year: parsed?.year ? field(String(parsed.year), c, origin) : empty,
    manufacturer: parsed?.manufacturer
      ? field(parsed.manufacturer, c, origin)
      : empty,
    brand: parsed?.brand ? field(parsed.brand, c, origin) : empty,
    setName: parsed?.setName ? field(parsed.setName, c * 0.9, origin) : empty,
    subsetInsert: extra.subsetInsert ?? empty,
    collectorNumber: parsed?.collectorNumber
      ? field(parsed.collectorNumber, c, origin)
      : empty,
    team: extra.team ?? empty,
    rookie: extra.rookie ?? empty,
    parallel: parsed?.parallel ? field(parsed.parallel, c * 0.75, origin) : empty,
    serialNumber: parsed?.serialMax
      ? field(`/${parsed.serialMax}`, c * 0.8, origin)
      : empty,
    autograph: parsed?.autograph ? field("true", c, origin) : empty,
    relic: parsed?.relic ? field("true", c, origin) : empty,
  };
}

const TEAM_RE =
  /\b(cowboys|lakers|yankees|chiefs|celtics|packers|dodgers|eagles|49ers|niners|giants|jets|bears|lions|vikings|saints|falcons|ravens|steelers|browns|bengals|colts|texans|titans|jaguars|broncos|raiders|chargers|seahawks|rams|cardinals|buccaneers|dolphins|patriots|bills|commanders|warriors|celtics|heat|nuggets|bucks|knicks|nets|sixers|76ers|bulls|pistons|cavaliers|hawks|hornets|wizards|magic|raptors|grizzlies|pelicans|spurs|mavericks|rockets|thunder|timberwolves|jazz|suns|kings|clippers|red sox|cubs|mets|braves|phillies|astros|guardians|orioles|twins|royals|white sox|tigers|rangers|mariners|angels|padres|giants|rockies|nationals|pirates|reds|brewers|blue jays|marlins|rays|blackhawks|bruins|rangers|maple leafs|canadiens|penguins|capitals)\b/;

function extrasFromText(
  text: string,
  origin: EvidenceOrigin,
): Partial<Record<keyof CardIdentityFields, EvidenceField>> {
  const t = text.toLowerCase();
  const extra: Partial<Record<keyof CardIdentityFields, EvidenceField>> = {};
  if (/\b(rc|rookie)\b/.test(t)) extra.rookie = field("true", 0.55, origin);
  if (/\b(downtown|insert|subset)\b/.test(t)) {
    extra.subsetInsert = field(
      t.includes("downtown") ? "Downtown" : "insert",
      0.5,
      origin,
    );
  }
  const team = t.match(TEAM_RE);
  if (team) extra.team = field(team[1]!, 0.45, origin);
  return extra;
}

function lastName(value: string): string | null {
  const tokens = value
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 2 && !isSportsStopToken(t) && !/^\d+$/.test(t));
  return tokens.length ? tokens[tokens.length - 1]! : null;
}

function compatibleValues(a: string, b: string): boolean {
  const av = a.toLowerCase();
  const bv = b.toLowerCase();
  if (av === bv || av.includes(bv) || bv.includes(av)) return true;
  const al = lastName(a);
  const bl = lastName(b);
  return Boolean(al && bl && al === bl);
}

export function isCompleteFields(f: CardIdentityFields): boolean {
  const words = f.playerOrCharacter.value
    ? f.playerOrCharacter.value.split(/\s+/).length
    : 0;
  const category = (f.category.value ?? "sports").toLowerCase();
  if (category === "pokemon" || category === "mtg" || category === "one_piece") {
    return Boolean(f.playerOrCharacter.value && f.collectorNumber.value && words >= 1);
  }
  return Boolean(
    f.year.value &&
      (f.brand.value || f.manufacturer.value) &&
      words >= 2 &&
      f.collectorNumber.value,
  );
}

export function fieldsFromStructuredOcr(
  extract: StructuredOcrExtract,
  origin: EvidenceOrigin,
  category: string = "sports",
  confidence = OCR_FIELD_CONFIDENCE,
): CardIdentityFields {
  const empty = unknownField(origin);
  return {
    category: extract.player || extract.year || extract.number
      ? field(category, 0.5, origin)
      : empty,
    playerOrCharacter: extract.player ? field(extract.player, confidence, origin) : empty,
    year: extract.year ? field(String(extract.year), confidence, origin) : empty,
    manufacturer: extract.manufacturer
      ? field(extract.manufacturer, confidence, origin)
      : empty,
    brand: extract.brand ? field(extract.brand, confidence, origin) : empty,
    setName: extract.set ? field(extract.set, confidence * 0.9, origin) : empty,
    subsetInsert: empty,
    collectorNumber: extract.number ? field(extract.number, confidence, origin) : empty,
    team: empty,
    rookie: empty,
    parallel: empty,
    serialNumber: empty,
    autograph: empty,
    relic: empty,
  };
}

export function emptyIdentityFields(origin: EvidenceOrigin = "inference"): CardIdentityFields {
  const empty = unknownField(origin);
  return {
    category: empty,
    playerOrCharacter: empty,
    year: empty,
    manufacturer: empty,
    brand: empty,
    setName: empty,
    subsetInsert: empty,
    collectorNumber: empty,
    team: empty,
    rookie: empty,
    parallel: empty,
    serialNumber: empty,
    autograph: empty,
    relic: empty,
  };
}

function isCompleteBase(parsed: SportsParsedIdentity | null): boolean {
  if (!parsed) return false;
  const words = parsed.player ? parsed.player.split(/\s+/).length : 0;
  return Boolean(
    parsed.year &&
      (parsed.brand || parsed.manufacturer) &&
      words >= 2 &&
      parsed.collectorNumber &&
      parsed.numberFromLabel,
  );
}

function pick(
  a: EvidenceField,
  b: EvidenceField,
  conflicts: string[],
  name: string,
  prefer: "front" | "back" | "none",
): EvidenceField {
  if (!a.value && !b.value) return unknownField("inference");
  if (a.value && !b.value) return a;
  if (b.value && !a.value) return b;
  if (compatibleValues(a.value!, b.value!)) {
    return a.confidence >= b.confidence ? a : b;
  }
  // Foil-front OCR often invents a player/year. A complete back parse wins
  // without a CONFLICT that would hide the real identity on Scan.
  if (prefer === "back") return b;
  if (prefer === "front") return a;
  if (a.confidence >= 0.8 && a.confidence - b.confidence >= 0.12) return a;
  if (b.confidence >= 0.8 && b.confidence - a.confidence >= 0.12) return b;
  conflicts.push(`${name}: front “${a.value}” vs back “${b.value}”`);
  return unknownField("inference");
}

/**
 * Fuse front + back into one evidence package.
 * Conflicts are listed — never silently chosen.
 */
/** Cities and regions on team cards ("Cleveland Browns", "New York"). */
const TEAM_PLACES = [
  "arizona", "atlanta", "baltimore", "boston", "brooklyn", "buffalo", "calgary", "carolina", "charlotte",
  "chicago", "cincinnati", "cleveland", "colorado", "columbus", "dallas", "denver", "detroit", "edmonton",
  "florida", "golden state", "green bay", "houston", "indiana", "indianapolis", "jacksonville", "kansas city",
  "las vegas", "los angeles", "memphis", "miami", "milwaukee", "minnesota", "montreal", "nashville",
  "new england", "new jersey", "new orleans", "new york", "oakland", "oklahoma city", "orlando", "ottawa",
  "philadelphia", "phoenix", "pittsburgh", "portland", "sacramento", "san antonio", "san diego",
  "san francisco", "seattle", "st louis", "tampa bay", "tennessee", "texas", "toronto", "utah", "vancouver",
  "washington", "winnipeg",
];

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/**
 * True when a "player" read is really a team, a city or a company line: "Texans LS",
 * "Cleveland Browns", "Mew York" (one misread letter), "Erica Inc". A real name that merely
 * contains a nickname word ("Magic Johnson") is kept.
 */
export function isNonPlayerName(value: string): boolean {
  const v = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!v) return false;
  if (/\b(inc|llc|ltd|corp|co)$/.test(v)) return true;
  const place = TEAM_PLACES.find((c) => v === c || v.startsWith(`${c} `) || editDistance(v, c) <= 1);
  const rest = place ? v.slice(v.startsWith(`${place} `) ? place.length + 1 : v.length).trim() : v;
  if (place && !rest) return true;
  // Team nickname, optionally after a place, optionally followed by a 1–2 letter OCR fragment.
  const words = rest.split(" ");
  const tail = words.length > 1 && words[words.length - 1]!.length <= 2 ? words.slice(0, -1) : words;
  const nickname = tail.join(" ");
  return Boolean(nickname) && new RegExp(`^${TEAM_RE.source}$`).test(nickname);
}

/** Drop a team/city/company read as the player; it is not identity evidence for a person. */
export function withoutNonPlayerName(fields: CardIdentityFields): CardIdentityFields {
  const p = fields.playerOrCharacter.value;
  if (!p || fields.category.value === "pokemon" || !isNonPlayerName(p)) return fields;
  return { ...fields, playerOrCharacter: unknownField("inference") };
}

/**
 * A copyright or season year ("© 2025", "2025-26") is often read as the card number. Treat a
 * four-digit 19xx/20xx number within a year of the card's year (or with no year read) as unknown.
 */
export function withoutYearAsNumber(fields: CardIdentityFields): CardIdentityFields {
  const n = fields.collectorNumber.value;
  if (!n || !/^(19|20)\d{2}$/.test(n)) return fields;
  const year = Number(fields.year.value);
  if (fields.year.value && Number.isFinite(year) && Math.abs(Number(n) - year) > 1) return fields;
  return { ...fields, collectorNumber: unknownField("inference") };
}

export function fuseCardEvidence(input: {
  frontText: string;
  backText: string;
  frontOrigin?: EvidenceOrigin;
  backOrigin?: EvidenceOrigin;
}): CardIdentityEvidence {
  const frontOrigin = input.frontOrigin ?? "front_text";
  const backOrigin = input.backOrigin ?? "back_text";
  const frontParsed = parseSportsIdentity(input.frontText);
  const backParsed = parseSportsIdentity(input.backText);
  const front = fromParsed(
    frontParsed,
    frontOrigin,
    extrasFromText(input.frontText, frontOrigin),
  );
  const back = fromParsed(
    backParsed,
    backOrigin,
    extrasFromText(input.backText, backOrigin),
  );
  const conflictNotes: string[] = [];
  const frontComplete = isCompleteBase(frontParsed);
  const backComplete = isCompleteBase(backParsed);
  const prefer: "front" | "back" | "none" =
    backComplete && !frontComplete
      ? "back"
      : frontComplete && !backComplete
        ? "front"
        : "none";
  const fused: CardIdentityFields = {
    category: pick(front.category, back.category, conflictNotes, "category", prefer),
    playerOrCharacter: pick(
      front.playerOrCharacter,
      back.playerOrCharacter,
      conflictNotes,
      "player",
      prefer,
    ),
    year: pick(front.year, back.year, conflictNotes, "year", prefer),
    manufacturer: pick(front.manufacturer, back.manufacturer, conflictNotes, "manufacturer", prefer),
    brand: pick(front.brand, back.brand, conflictNotes, "brand", prefer),
    setName: pick(front.setName, back.setName, conflictNotes, "set", prefer),
    subsetInsert: pick(front.subsetInsert, back.subsetInsert, conflictNotes, "insert", prefer),
    collectorNumber: pick(
      front.collectorNumber,
      back.collectorNumber,
      conflictNotes,
      "number",
      prefer,
    ),
    team: pick(front.team, back.team, conflictNotes, "team", prefer),
    rookie: pick(front.rookie, back.rookie, conflictNotes, "rookie", prefer),
    parallel: pick(front.parallel, back.parallel, conflictNotes, "parallel", prefer),
    serialNumber: pick(front.serialNumber, back.serialNumber, conflictNotes, "serial", prefer),
    autograph: pick(front.autograph, back.autograph, conflictNotes, "autograph", prefer),
    relic: pick(front.relic, back.relic, conflictNotes, "relic", prefer),
  };
  return { front, back, fused: withoutNonPlayerName(withoutYearAsNumber(fused)), conflictNotes };
}

export function fuseIdentitySides(input: {
  front: CardIdentityFields;
  back: CardIdentityFields;
}): CardIdentityEvidence {
  const conflictNotes: string[] = [];
  const frontComplete = isCompleteFields(input.front);
  const backComplete = isCompleteFields(input.back);
  const prefer: "front" | "back" | "none" =
    backComplete && !frontComplete
      ? "back"
      : frontComplete && !backComplete
        ? "front"
        : "none";
  const fused: CardIdentityFields = {
    category: pick(input.front.category, input.back.category, conflictNotes, "category", prefer),
    playerOrCharacter: pick(
      input.front.playerOrCharacter,
      input.back.playerOrCharacter,
      conflictNotes,
      "player",
      prefer,
    ),
    year: pick(input.front.year, input.back.year, conflictNotes, "year", prefer),
    manufacturer: pick(
      input.front.manufacturer,
      input.back.manufacturer,
      conflictNotes,
      "manufacturer",
      prefer,
    ),
    brand: pick(input.front.brand, input.back.brand, conflictNotes, "brand", prefer),
    setName: pick(input.front.setName, input.back.setName, conflictNotes, "set", prefer),
    subsetInsert: pick(
      input.front.subsetInsert,
      input.back.subsetInsert,
      conflictNotes,
      "insert",
      prefer,
    ),
    collectorNumber: pick(
      input.front.collectorNumber,
      input.back.collectorNumber,
      conflictNotes,
      "number",
      prefer,
    ),
    team: pick(input.front.team, input.back.team, conflictNotes, "team", prefer),
    rookie: pick(input.front.rookie, input.back.rookie, conflictNotes, "rookie", prefer),
    parallel: pick(input.front.parallel, input.back.parallel, conflictNotes, "parallel", prefer),
    serialNumber: pick(
      input.front.serialNumber,
      input.back.serialNumber,
      conflictNotes,
      "serial",
      prefer,
    ),
    autograph: pick(input.front.autograph, input.back.autograph, conflictNotes, "autograph", prefer),
    relic: pick(input.front.relic, input.back.relic, conflictNotes, "relic", prefer),
  };
  return { front: input.front, back: input.back, fused: withoutNonPlayerName(withoutYearAsNumber(fused)), conflictNotes };
}

/** Fill empty fused fields from overlay. Incompatible observed values become conflicts. */
export function overlayIdentityFields(
  base: CardIdentityFields,
  overlay: CardIdentityFields,
  conflicts: string[],
  label: string,
): CardIdentityFields {
  const out = { ...base };
  const keys = Object.keys(base) as Array<keyof CardIdentityFields>;
  for (const key of keys) {
    const a = base[key];
    const b = overlay[key];
    if (!b.value) continue;
    if (!a.value) {
      out[key] = b;
      continue;
    }
    if (compatibleValues(a.value, b.value)) {
      out[key] = a.confidence >= b.confidence ? a : b;
      continue;
    }
    conflicts.push(`${key}: ${label} “${b.value}” vs “${a.value}”`);
    out[key] = unknownField("inference");
  }
  return withoutNonPlayerName(withoutYearAsNumber(out));
}

export function structuredIdentityQuery(fields: CardIdentityFields): string {
  // TCG catalogs key on name plus the printed collector number, and a year or
  // brand token only pulls the search off the card.
  const category = (fields.category.value ?? "sports").toLowerCase();
  if (category === "pokemon" || category === "mtg" || category === "one_piece") {
    return [fields.playerOrCharacter.value, fields.collectorNumber.value]
      .filter(Boolean)
      .join(" ");
  }
  // Name first so TCGdex/Scryfall search the card, not the year/brand.
  return [
    fields.playerOrCharacter.value,
    fields.collectorNumber.value && `#${fields.collectorNumber.value}`,
    fields.brand.value,
    fields.manufacturer.value,
    fields.year.value,
  ]
    .filter(Boolean)
    .join(" ");
}

export function baseVsParallelFromEvidence(evidence: CardIdentityEvidence) {
  const f = evidence.fused;
  const setish = f.brand.value ?? f.manufacturer.value;
  const parts = [
    f.year.value,
    setish,
    f.collectorNumber.value && `#${f.collectorNumber.value}`,
    f.playerOrCharacter.value,
  ].filter(Boolean);
  const baseVals = [f.year, f.brand, f.collectorNumber, f.playerOrCharacter].filter((x) => x.value);
  const baseConfidence =
    baseVals.length === 0
      ? 0
      : Number(
          (
            baseVals.reduce((s, x) => s + x.confidence, 0) / baseVals.length
          ).toFixed(3),
        );
  const parallelConfidence = f.parallel.value ? f.parallel.confidence : 0;
  return {
    baseDisplayName: parts.length ? parts.join(" ") : null,
    baseConfidence,
    parallelDisplayName: f.parallel.value,
    parallelConfidence,
    notes: evidence.conflictNotes.length
      ? evidence.conflictNotes.join("; ")
      : "Weak parallel does not invalidate base identity",
  };
}
