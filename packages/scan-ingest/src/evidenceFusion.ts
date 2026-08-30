import {
  field,
  unknownField,
  type CardIdentityEvidence,
  type CardIdentityFields,
  type EvidenceField,
  type EvidenceOrigin,
} from "@vip/core-model";
import { parseSportsIdentity, type SportsParsedIdentity } from "./sportsIdentity.js";

function fromParsed(
  parsed: SportsParsedIdentity | null,
  origin: EvidenceOrigin,
  extra: Partial<Record<keyof CardIdentityFields, EvidenceField>> = {},
): CardIdentityFields {
  const c = parsed ? Math.min(0.72, parsed.confidence) : 0;
  const empty = unknownField(origin);
  return {
    category: parsed ? field("sports", 0.5, origin) : empty,
    playerOrCharacter: parsed?.player
      ? field(parsed.player, c, origin)
      : empty,
    year: parsed?.year ? field(String(parsed.year), c, origin) : empty,
    manufacturer: empty,
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
  const team = t.match(
    /\b(cowboys|lakers|yankees|chiefs|celtics|packers|dodgers)\b/,
  );
  if (team) extra.team = field(team[1]!, 0.45, origin);
  return extra;
}

function pick(
  a: EvidenceField,
  b: EvidenceField,
  conflicts: string[],
  name: string,
): EvidenceField {
  if (!a.value && !b.value) return unknownField("inference");
  if (a.value && !b.value) return a;
  if (b.value && !a.value) return b;
  const av = a.value!.toLowerCase();
  const bv = b.value!.toLowerCase();
  if (av === bv || av.includes(bv) || bv.includes(av)) {
    return a.confidence >= b.confidence ? a : b;
  }
  conflicts.push(`${name}: front “${a.value}” vs back “${b.value}”`);
  return unknownField("inference");
}

/**
 * Fuse front + back into one evidence package.
 * Conflicts are listed — never silently chosen.
 */
export function fuseCardEvidence(input: {
  frontText: string;
  backText: string;
}): CardIdentityEvidence {
  const frontParsed = parseSportsIdentity(input.frontText);
  const backParsed = parseSportsIdentity(input.backText);
  const front = fromParsed(frontParsed, "front_text", extrasFromText(input.frontText, "front_text"));
  const back = fromParsed(backParsed, "back_text", extrasFromText(input.backText, "back_text"));
  const conflictNotes: string[] = [];
  const fused: CardIdentityFields = {
    category: pick(front.category, back.category, conflictNotes, "category"),
    playerOrCharacter: pick(
      front.playerOrCharacter,
      back.playerOrCharacter,
      conflictNotes,
      "player",
    ),
    year: pick(front.year, back.year, conflictNotes, "year"),
    manufacturer: pick(front.manufacturer, back.manufacturer, conflictNotes, "manufacturer"),
    brand: pick(front.brand, back.brand, conflictNotes, "brand"),
    setName: pick(front.setName, back.setName, conflictNotes, "set"),
    subsetInsert: pick(front.subsetInsert, back.subsetInsert, conflictNotes, "insert"),
    collectorNumber: pick(
      front.collectorNumber,
      back.collectorNumber,
      conflictNotes,
      "number",
    ),
    team: pick(front.team, back.team, conflictNotes, "team"),
    rookie: pick(front.rookie, back.rookie, conflictNotes, "rookie"),
    parallel: pick(front.parallel, back.parallel, conflictNotes, "parallel"),
    serialNumber: pick(front.serialNumber, back.serialNumber, conflictNotes, "serial"),
    autograph: pick(front.autograph, back.autograph, conflictNotes, "autograph"),
    relic: pick(front.relic, back.relic, conflictNotes, "relic"),
  };
  return { front, back, fused, conflictNotes };
}

export function baseVsParallelFromEvidence(evidence: CardIdentityEvidence) {
  const f = evidence.fused;
  const parts = [f.year.value, f.brand.value, f.collectorNumber.value && `#${f.collectorNumber.value}`, f.playerOrCharacter.value]
    .filter(Boolean);
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
