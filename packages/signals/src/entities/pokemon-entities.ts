/**
 * Pokémon entity extraction (pure). Finds sets, cards, products and Pokémon in
 * headline text and cross-references the catalogs the caller passes in
 * (national Dex species, IQVault set names). A mention that matches no
 * catalog gets no identity: entity_ref stays null, so nothing new is minted
 * because a source spells a name differently. References are text
 * placeholders until the entity layer exists (P7); never a priced_unit join.
 */
import { z } from "zod";

export const POKEMON_ENTITY_EXTRACTOR_VERSION = "pokemon-entities@0.1.0";

export const EntityKindSchema = z.enum(["set", "card", "product", "pokemon"]);
export type EntityKind = z.infer<typeof EntityKindSchema>;

export const EntityMatchMethodSchema = z.enum([
  "species_catalog",
  "set_catalog",
  "quoted_set_name",
  "learned_set_name",
  "card_pattern",
  "product_pattern",
]);
export type EntityMatchMethod = z.infer<typeof EntityMatchMethodSchema>;

export const EntityMentionSchema = z
  .object({
    kind: EntityKindSchema,
    mention: z.string().min(1),
    normalizedKey: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    entityRef: z.string().min(1).nullable(),
    method: EntityMatchMethodSchema,
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type EntityMention = z.infer<typeof EntityMentionSchema>;

export type PokemonCatalog = {
  /** National Dex number → English species name. */
  species: Readonly<Record<number, string>>;
  /** Known set names with the IQVault reference to attach. */
  sets: ReadonlyArray<{ name: string; ref: string }>;
  /** Set names learned from earlier quoted mentions; matched without an identity. */
  learnedSets?: ReadonlyArray<string>;
  /** Card names IQVault already holds (binder slots), normalized with entityKey. */
  knownCardKeys?: ReadonlySet<string>;
};

/** Accents stripped, lowercase, non-alphanumerics collapsed: "Flabébé" → "flabebe", "Heat Rotom ex" → "heat-rotom-ex". */
export function entityKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/♀/g, " f")
    .replace(/♂/g, " m")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Matching form: accents stripped and apostrophes/quotes unified, same length as the input. */
function foldForMatch(s: string): string {
  return s
    .normalize("NFC")
    .split("")
    .map((ch) => (ch === "’" || ch === "‘" ? "'" : ch.normalize("NFKD").replace(/[̀-ͯ]/g, "") || ch).slice(0, 1))
    .join("");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const B = "(?<![A-Za-z0-9])";
const E = "(?![A-Za-z0-9])";

/** Set names that are also a mechanic, a game or a generation; matched only next to a set word. */
const AMBIGUOUS_SET_NAMES = new Set(["151", "mega-evolution", "scarlet-violet", "sword-shield", "pokemon-go", "sun-moon", "black-white", "x-y"]);
const SET_CONTEXT = /^\s*(sets?|cards?|card images|booster|boosters|elite trainer|etb|expansion|preorders?|prerelease|pull rates|promos?|products?|collection|box|tins?)\b/i;

const CARD_SUFFIX = /^\s+(ex|EX|GX|V|VMAX|VSTAR|BREAK|Prime|LV\.X|δ)(?![A-Za-z0-9])/;
const CARD_PREFIX = /(?:^|\s)(Mega|Alolan|Galarian|Hisuian|Paldean|Radiant|Shining|Dark|Light|Heat|Wash|Frost|Fan|Mow|Origin)\s+$/;

const PRODUCTS: ReadonlyArray<{ key: string; re: RegExp }> = [
  { key: "pokemon-center-etb", re: /\bPok[eé]mon Center (?:Elite Trainer Box(?:es)?|ETBs?)\b/gi },
  { key: "ultra-premium-collection", re: /\b(?:Ultra[- ]Premium Collections?|UPCs?)\b/g },
  { key: "premium-collection", re: /\bPremium Collections?\b/gi },
  { key: "etb", re: /\b(?:Elite Trainer Box(?:es)?|ETBs?)\b/g },
  { key: "booster-box", re: /\bBooster Box(?:es)?\b/gi },
  { key: "booster-bundle", re: /\bBooster Bundles?\b/gi },
  { key: "booster-pack", re: /\bBooster Packs?\b/gi },
  { key: "collection-box", re: /\b(?:Collection Box(?:es)?|(?:ex|V|Special|Poster|Premium Figure) Collection)\b/gi },
  { key: "mini-tin", re: /\bMini Tins?\b/gi },
  { key: "tin", re: /\bTins?\b/g },
  { key: "prerelease-kit", re: /\b(?:Prerelease (?:Kits?|Packs?)|Build (?:&|and) Battle(?: Box(?:es)?)?)\b/gi },
  { key: "blister", re: /\bBlisters?\b/gi },
  { key: "deck", re: /\b(?:League Battle|Battle|Theme|Starter|Battle Academy) Decks?\b/gi },
  { key: "binder", re: /\bBinders?\b/gi },
  { key: "promo", re: /\bPromo(?:s| Cards?)?\b/gi },
  { key: "accessory", re: /\b(?:Card Sleeves|Sleeves|Playmats?|Deck Box(?:es)?|Accessories)\b/gi },
];

export function extractPokemonEntities(text: string, catalog: PokemonCatalog): EntityMention[] {
  const folded = foldForMatch(text);
  const found = new Map<string, EntityMention>();
  const add = (m: EntityMention) => {
    const k = `${m.kind}:${m.normalizedKey}`;
    const prev = found.get(k);
    if (!prev || prev.confidence < m.confidence) found.set(k, EntityMentionSchema.parse(m));
  };

  // Products, longest patterns first; a span is used once ("Pokémon Center ETB" is not also an "ETB").
  const taken: Array<[number, number]> = [];
  const free = (s: number, e: number) => taken.every(([a, b]) => e <= a || s >= b);
  for (const p of PRODUCTS) {
    for (const m of folded.matchAll(p.re)) {
      const s = m.index!;
      const e = s + m[0].length;
      if (!free(s, e)) continue;
      taken.push([s, e]);
      add({ kind: "product", mention: text.slice(s, e), normalizedKey: p.key, entityRef: `product:${p.key}`, method: "product_pattern", confidence: 0.8 });
    }
  }

  // Sets: quoted names in PokéBeach's style, then catalog and learned names.
  const quoted = new Set<string>();
  for (const m of folded.matchAll(/["“]([^"”]{2,40})["”]/g)) {
    const name = m[1]!.trim();
    const after = folded.slice(m.index! + m[0].length);
    const before = folded.slice(0, m.index!);
    const titled = name.split(/\s+/).length <= 5 && name.split(/\s+/).every((w) => /^[A-Z0-9&]/.test(w));
    if (!titled || /[!?]$/.test(name)) continue;
    if (SET_CONTEXT.test(after) || /\b(?:from|in)\s*$/i.test(before)) quoted.add(name);
  }
  const catalogByKey = new Map(catalog.sets.map((s) => [entityKey(s.name), s]));
  for (const name of quoted) {
    const hit = catalogByKey.get(entityKey(name));
    add(
      hit
        ? { kind: "set", mention: name, normalizedKey: entityKey(name), entityRef: hit.ref, method: "set_catalog", confidence: 0.9 }
        : { kind: "set", mention: name, normalizedKey: entityKey(name), entityRef: null, method: "quoted_set_name", confidence: 0.6 },
    );
  }
  const named: Array<{ name: string; ref: string | null; method: EntityMatchMethod; confidence: number }> = [
    ...catalog.sets.map((s) => ({ name: s.name, ref: s.ref, method: "set_catalog" as const, confidence: 0.9 })),
    ...(catalog.learnedSets ?? [])
      .filter((n) => !catalogByKey.has(entityKey(n)))
      .map((n) => ({ name: n, ref: null, method: "learned_set_name" as const, confidence: 0.5 })),
  ].sort((a, b) => b.name.length - a.name.length);
  for (const s of named) {
    const re = new RegExp(`${B}${escapeRe(foldForMatch(s.name))}${E}`, "gi");
    for (const m of folded.matchAll(re)) {
      const after = folded.slice(m.index! + m[0].length);
      if (AMBIGUOUS_SET_NAMES.has(entityKey(s.name)) && !SET_CONTEXT.test(after)) continue;
      add({ kind: "set", mention: text.slice(m.index!, m.index! + m[0].length), normalizedKey: entityKey(s.name), entityRef: s.ref, method: s.method, confidence: s.confidence });
    }
  }

  // Pokémon (capitalized in the text), longest names first so "Mewtwo" never yields "Mew"; cards from suffix/prefix.
  if (Object.keys(catalog.species).length === 0) return [...found.values()];
  const species = Object.entries(catalog.species)
    .map(([dex, name]) => ({ dex: Number(dex), name, folded: foldForMatch(name) }))
    .sort((a, b) => b.folded.length - a.folded.length);
  const speciesRe = new RegExp(`${B}(${species.map((s) => escapeRe(s.folded)).join("|")})${E}`, "gi");
  const byFolded = new Map(species.map((s) => [s.folded.toLowerCase(), s]));
  for (const m of folded.matchAll(speciesRe)) {
    const s = m.index!;
    const original = text.slice(s, s + m[0].length);
    if (!/^[A-Z]/.test(original)) continue;
    const sp = byFolded.get(m[0].toLowerCase())!;
    add({ kind: "pokemon", mention: sp.name, normalizedKey: entityKey(sp.name), entityRef: `pokemon:dex:${sp.dex}`, method: "species_catalog", confidence: 0.8 });

    const suffix = CARD_SUFFIX.exec(folded.slice(s + m[0].length));
    const prefix = CARD_PREFIX.exec(folded.slice(0, s));
    if (suffix || prefix?.[1] === "Mega") {
      const start = prefix ? s - prefix[0].trimStart().length : s;
      const end = s + m[0].length + (suffix ? suffix[0].length : 0);
      const cardName = text.slice(start, end).trim();
      const key = entityKey(cardName);
      const known = catalog.knownCardKeys?.has(key) ?? false;
      add({ kind: "card", mention: cardName, normalizedKey: key, entityRef: known ? `binder_card:${key}` : null, method: "card_pattern", confidence: known ? 0.85 : 0.7 });
    }
  }

  return [...found.values()];
}

/** Quoted set-name candidates only, so a batch can learn names before matching plain mentions. */
export function quotedSetCandidates(text: string): string[] {
  return extractPokemonEntities(text, { species: {}, sets: [] })
    .filter((e) => e.method === "quoted_set_name")
    .map((e) => e.mention);
}
