/**
 * Pokémon OCR is evidence, not identity. Lift a species / trainer title and
 * collector NNN/NNN from noisy Ricoh text so TCGdex has a real query.
 * Mapped pokedex → name is inferred · unverified.
 */
import { SPECIES_BY_DEX } from "./pokemonSpecies.js";
import { ATTACK_NAME_HINTS, TRAINER_ITEM_TITLES } from "./pokemonTitles.js";

export type PokemonOcrExtract = {
  name: string | null;
  collectorNumber: string | null;
  localId: string | null;
  pokedexNumber: number | null;
  methods: string[];
  confidence: number;
};

type SpeciesEntry = {
  display: string;
  folded: string;
  compact: string;
};

const SPECIES_INDEX: SpeciesEntry[] = (() => {
  const seen = new Set<string>();
  const rows: SpeciesEntry[] = [];
  for (const display of Object.values(SPECIES_BY_DEX)) {
    const folded = fold(display);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    rows.push({ display, folded, compact: folded.replace(/\s+/g, "") });
  }
  rows.sort((a, b) => b.folded.length - a.folded.length);
  return rows;
})();

const TITLE_INDEX = TRAINER_ITEM_TITLES.map((display) => ({
  display,
  folded: fold(display),
})).sort((a, b) => b.folded.length - a.folded.length);

export function foldPokemonText(text: string): string {
  return fold(text);
}

function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikePokemonOcr(text: string): boolean {
  return /pok[eé]mon|weakness|retreat|\billus\.?\b|basic energy|game freak|nintendo \/ creatures/i.test(
    text,
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasFoldedPhrase(hay: string, phrase: string): boolean {
  if (!phrase) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRe(phrase)}(?![a-z0-9])`).test(hay);
}

function isEditDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++diffs > 1) return false;
    }
    return diffs === 1;
  }
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    i += 1;
  }
  return true;
}

function plausibleLocal(n: number): boolean {
  return n >= 1 && n <= 399;
}

function parseCollectorPairs(text: string): Array<{ local: string; printed: string }> {
  const out: Array<{ local: string; printed: string }> = [];
  const re = /(\d{1,4})\s*[/|]\s*(\d{1,4})/g;
  for (const m of text.matchAll(re)) {
    const a = m[1]!;
    const b = m[2]!;
    const na = Number(a);
    const nb = Number(b);
    if (a.length <= 3 && b.length <= 3 && plausibleLocal(na) && nb >= 20 && nb <= 399) {
      out.push({ local: a, printed: b });
      continue;
    }
    if (a.length === 4 && b.length === 4) {
      const first3 = { local: a.slice(0, 3), printed: b.slice(0, 3) };
      if (plausibleLocal(Number(first3.local)) && Number(first3.printed) >= 20) {
        out.push(first3);
      }
    }
    if (a.length <= 3 && plausibleLocal(na) && b.length <= 3) {
      out.push({ local: a, printed: b });
    }
  }
  return out;
}

function parsePokedexNumber(text: string): number | null {
  const matches = [...text.matchAll(/\bno[.\s_]+0*(\d{1,4})\b/gi)];
  for (const m of matches.reverse()) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 1025 && SPECIES_BY_DEX[n]) return n;
  }
  return null;
}

function findTrainerTitle(folded: string): string | null {
  for (const row of TITLE_INDEX) {
    if (row.folded.length < 8) continue;
    if (hasFoldedPhrase(folded, row.folded)) return row.display;
  }
  return null;
}

function findSpeciesName(folded: string): { name: string; method: string } | null {
  const compactHay = folded.replace(/\s+/g, "");
  for (const row of SPECIES_INDEX) {
    if (hasFoldedPhrase(folded, row.folded)) {
      return { name: row.display, method: `species:${row.display}` };
    }
    if (row.compact.length >= 6 && compactHay.includes(row.compact)) {
      return { name: row.display, method: `species_blob:${row.display}` };
    }
  }

  const tokens = folded.split(" ").filter((t) => t.length >= 6);
  for (const token of tokens) {
    const fuzzy = SPECIES_INDEX.filter(
      (row) =>
        row.compact.length >= 6 &&
        Math.abs(row.compact.length - token.length) <= 1 &&
        isEditDistanceAtMost1(token, row.compact),
    );
    if (fuzzy.length === 1) {
      return { name: fuzzy[0]!.display, method: `species_fuzzy:${fuzzy[0]!.display}` };
    }
    const prefixed = SPECIES_INDEX.filter(
      (row) =>
        row.compact.startsWith(token) && row.compact.length - token.length <= 2,
    );
    if (prefixed.length === 1) {
      return { name: prefixed[0]!.display, method: `species_prefix:${prefixed[0]!.display}` };
    }
  }
  return null;
}

function findAttackHint(folded: string): string | null {
  for (const [attack, species] of Object.entries(ATTACK_NAME_HINTS)) {
    if (hasFoldedPhrase(folded, attack)) return species;
  }
  return null;
}

/**
 * Pull a Pokémon card name + collector number from noisy front OCR.
 * Never invents a verified identity — caller marks inferred · unverified.
 */
export function extractPokemonFromOcr(text: string): PokemonOcrExtract {
  const methods: string[] = [];
  const folded = fold(text);
  const pairs = parseCollectorPairs(text);
  const pair = pairs.length ? pairs[pairs.length - 1]! : null;
  const collectorNumber = pair ? `${pair.local}/${pair.printed}` : null;
  const localId = pair?.local ?? null;
  if (collectorNumber) methods.push(`collector:${collectorNumber}`);

  const pokedexNumber = parsePokedexNumber(text);
  if (pokedexNumber) methods.push(`pokedex:${pokedexNumber}`);

  const species = findSpeciesName(folded);
  const trainer = findTrainerTitle(folded);
  const attack = findAttackHint(folded);

  let name: string | null = null;
  let confidence = 0;
  if (species) {
    name = species.name;
    methods.push(species.method);
    confidence = species.method.startsWith("species_fuzzy")
      ? 0.7
      : species.method.startsWith("species_prefix")
        ? 0.68
        : 0.82;
  } else if (trainer) {
    name = trainer;
    methods.push(`title:${trainer}`);
    confidence = 0.84;
  } else if (pokedexNumber && SPECIES_BY_DEX[pokedexNumber]) {
    name = SPECIES_BY_DEX[pokedexNumber]!;
    methods.push(`pokedex_name:${name}`);
    confidence = 0.75;
  } else if (attack) {
    name = attack;
    methods.push(`attack:${attack}`);
    confidence = 0.62;
  } else if (/\bbasic\b.{0,24}\benergy\b/.test(folded)) {
    name = "Basic Energy";
    methods.push("title:Basic Energy");
    confidence = 0.7;
  } else if (/\bstadium\b/.test(folded) && collectorNumber) {
    name = "Stadium";
    methods.push("title:Stadium");
    confidence = 0.5;
  }

  if (name && collectorNumber) {
    confidence = Math.min(0.9, confidence + 0.05);
  }

  return {
    name,
    collectorNumber,
    localId,
    pokedexNumber,
    methods,
    confidence,
  };
}
