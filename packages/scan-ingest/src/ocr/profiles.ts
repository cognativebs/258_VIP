import { z } from "zod";
import {
  ScanCategorySchema,
  ScanVerticalSchema,
  type ScanCategory,
  type ScanVertical,
} from "../schemas.js";

/**
 * Card-family split. Sports backs are biography/stats; TCG backs are
 * rules text. One classifier cannot serve both without poisoning names.
 */
export const ScanFamilySchema = z.enum(["sports", "tcg"]);
export type ScanFamily = z.infer<typeof ScanFamilySchema>;

/**
 * Vertical-specific identifying mechanics. Inventory category stays the
 * family bucket (`sports` / `pokemon` / `mtg` / `one_piece`); this is the
 * OCR + parse profile the operator (or a later detector) selected.
 */
export { ScanVerticalSchema, type ScanVertical };

export const OcrProfileIdSchema = z.enum([
  "sports_generic",
  "football",
  "baseball",
  "soccer",
  "basketball",
  "tcg_generic",
  "pokemon",
  "mtg",
  "one_piece",
]);
export type OcrProfileId = z.infer<typeof OcrProfileIdSchema>;

/** Operator dropdown / API hint — family, vertical, or inventory category. */
export const ScanCategoryHintSchema = z.enum([
  "sports",
  "sports_generic",
  "football",
  "baseball",
  "soccer",
  "basketball",
  "tcg",
  "tcg_generic",
  "pokemon",
  "mtg",
  "one_piece",
]);
export type ScanCategoryHint = z.infer<typeof ScanCategoryHintSchema>;

export const OcrEngineSettingsSchema = z.object({
  lang: z.string().min(1),
  psm: z.number().int().min(0).max(13),
});
export type OcrEngineSettings = z.infer<typeof OcrEngineSettingsSchema>;

export const OcrTitleRuleSchema = z.object({
  minWords: z.number().int().min(1),
  maxWords: z.number().int().min(1),
  allowSingleWord: z.boolean(),
  allowDigits: z.boolean(),
});
export type OcrTitleRule = z.infer<typeof OcrTitleRuleSchema>;

export const OcrCompletenessRuleSchema = z.object({
  requireYear: z.boolean(),
  requireName: z.boolean(),
  requireNumber: z.boolean(),
  requireBrandOrSet: z.boolean(),
  minNameWords: z.number().int().min(1),
});
export type OcrCompletenessRule = z.infer<typeof OcrCompletenessRuleSchema>;

export const ResolvedScanProfileSchema = z.object({
  profileId: OcrProfileIdSchema,
  family: ScanFamilySchema,
  vertical: ScanVerticalSchema.nullable(),
  category: ScanCategorySchema,
  source: z.enum(["operator", "inferred", "default"]),
  confidence: z.number().min(0).max(1),
});
export type ResolvedScanProfile = z.infer<typeof ResolvedScanProfileSchema>;

export type OcrProfile = {
  id: OcrProfileId;
  family: ScanFamily;
  vertical: ScanVertical | null;
  category: ScanCategory;
  displayName: string;
  ruleOrModelVersion: string;
  tesseract: OcrEngineSettings;
  title: OcrTitleRule;
  completeness: OcrCompletenessRule;
  bodyMarkers: RegExp;
  copyrightMarkers: RegExp;
  productTokens: RegExp;
  labeledNumber: RegExp;
  collectorNumber: RegExp;
  rejectAsNumber: RegExp;
  teamTokens: RegExp | null;
};

export const OCR_PROFILE_RULE = "scan-ocr-profile@1.0.0";

const SPORTS_TES = { lang: "eng", psm: 6 } as const;
const TCG_TES = { lang: "eng", psm: 4 } as const;

const SPORTS_TITLE: OcrTitleRule = {
  minWords: 2,
  maxWords: 3,
  allowSingleWord: false,
  allowDigits: false,
};
const TCG_TITLE: OcrTitleRule = {
  minWords: 1,
  maxWords: 6,
  allowSingleWord: true,
  allowDigits: true,
};

const SPORTS_COMPLETE: OcrCompletenessRule = {
  requireYear: true,
  requireName: true,
  requireNumber: true,
  requireBrandOrSet: true,
  minNameWords: 2,
};
const TCG_COMPLETE: OcrCompletenessRule = {
  requireYear: false,
  requireName: true,
  requireNumber: true,
  requireBrandOrSet: false,
  minNameWords: 1,
};

const SPORTS_BODY =
  /\b(brought|season|career|drafted|selected|traded|signed|passed|rushed|yards?|touchdowns?|points|average|record|led the|in his|during the|after the|before the|rookie year|pro bowl|all[- ]pro|super bowl|batting|rebounds|assists|goals|appearances|midfielder|striker|quarterback)\b/i;
const SPORTS_COPY =
  /\b(copyright|©|\(c\)|llc|inc\.|panini america|topps company|upper deck)\b/i;
const SPORTS_PRODUCT =
  /\b(panini|topps|donruss|prizm|select|optic|mosaic|bowman|fleer|score|upper\s*deck|leaf|sage|chronicles|contenders|certified|absolute|phoenix|zenith|prestige|playoff|limited|national\s+treasures|one\s+and\s+one|flawless|impeccable|encased|obsidian|spectra|revolution|illusions|hoops|stickers|chrome|heritage|finest|merlin)\b/i;
const SPORTS_LABELED = /(?:no\.?|#)\s*([A-Za-z]{0,4}\d{1,4}(?:[A-Za-z]\d?)?)\b/i;
const SPORTS_NUMBER = /(?:no\.?|#)\s*([A-Za-z]{0,4}\d{1,4}(?:[A-Za-z]\d?)?)\b/i;
const SPORTS_REJECT_NUM = /(?!)/; // sports labeled numbers are already tight

function sportsProfile(
  id: OcrProfileId,
  vertical: ScanVertical | null,
  displayName: string,
  extras: {
    body?: RegExp;
    product?: RegExp;
    team?: RegExp | null;
  } = {},
): OcrProfile {
  return {
    id,
    family: "sports",
    vertical,
    category: "sports",
    displayName,
    ruleOrModelVersion: OCR_PROFILE_RULE,
    tesseract: SPORTS_TES,
    title: SPORTS_TITLE,
    completeness: SPORTS_COMPLETE,
    bodyMarkers: extras.body ?? SPORTS_BODY,
    copyrightMarkers: SPORTS_COPY,
    productTokens: extras.product ?? SPORTS_PRODUCT,
    labeledNumber: SPORTS_LABELED,
    collectorNumber: SPORTS_NUMBER,
    rejectAsNumber: SPORTS_REJECT_NUM,
    teamTokens: extras.team ?? null,
  };
}

const FOOTBALL_BODY =
  /\b(brought|season|career|drafted|selected|traded|signed|passed|rushed|receiving|sacks?|interceptions?|yards?|touchdowns?|quarterback|wide receiver|running back|linebacker|pro bowl|all[- ]pro|super bowl|heisman|in his|during the|after the|before the|rookie year)\b/i;
const BASEBALL_BODY =
  /\b(batting|average|home\s+runs?|rbi|stolen|era|strikeouts?|innings?|prospect|drafted|signed|traded|career|season|world series|all[- ]star|in his|during the|after the|before the|rookie year)\b/i;
const SOCCER_BODY =
  /\b(goals?|assists?|appearances|midfielder|striker|forward|defender|goalkeeper|premier league|la liga|bundesliga|serie a|ligue 1|world cup|champions league|career|season|drafted|signed|traded|in his|during the)\b/i;
const BASKETBALL_BODY =
  /\b(points|rebounds|assists|steals|blocks|drafted|selected|traded|signed|career|season|nba finals|all[- ]star|all[- ]nba|sixth man|in his|during the|after the|before the|rookie year|led the)\b/i;

const FOOTBALL_TEAMS =
  /\b(cowboys|chiefs|packers|eagles|49ers|niners|giants|jets|bears|lions|vikings|saints|falcons|ravens|steelers|browns|bengals|colts|texans|titans|jaguars|broncos|raiders|chargers|seahawks|rams|cardinals|buccaneers|dolphins|patriots|bills|commanders|washington)\b/i;
const BASEBALL_TEAMS =
  /\b(yankees|red sox|cubs|mets|braves|phillies|astros|guardians|orioles|twins|royals|white sox|tigers|rangers|mariners|angels|padres|giants|dodgers|rockies|nationals|pirates|reds|brewers|blue jays|marlins|rays|cardinals)\b/i;
const SOCCER_TEAMS =
  /\b(manchester united|manchester city|liverpool|chelsea|arsenal|tottenham|real madrid|barcelona|bayern|juventus|psg|milan|inter|dortmund|ajax|celtic|rangers)\b/i;
const BASKETBALL_TEAMS =
  /\b(lakers|celtics|warriors|heat|nuggets|bucks|knicks|nets|sixers|76ers|bulls|pistons|cavaliers|hawks|hornets|wizards|raptors|grizzlies|pelicans|spurs|mavericks|rockets|thunder|timberwolves|jazz|suns|kings|clippers|pacers|magic)\b/i;

const POKEMON_BODY =
  /\b(weakness|resistance|retreat|attack|damage|flip a coin|this pokemon|your opponent|bench|prize|ability|poke[- ]?power|poke[- ]?body|during your|knocked out)\b/i;
const POKEMON_COPY =
  /\b(copyright|©|\(c\)|the pokemon company|nintendo|creatures|game freak|pokemon)\b/i;
const POKEMON_PRODUCT =
  /\b(pokemon|pok[eé]mon|scarlet|violet|base set|jungle|fossil|sword|shield|sun|moon|ex|gx|vmax|vstar|promo|svp)\b/i;
const POKEMON_LABELED =
  /(?:no\.?|#)\s*([A-Za-z]{0,6}\d{1,4}(?:\/\d{1,4})?)\b/i;
const POKEMON_NUMBER =
  /\b((?:[A-Z]{2,4}\d{0,2}[-\s])?\d{1,3}\/\d{2,3}|TG\d{2}|SVP[-\s]?\d{1,4}|[A-Z]{2,4}\d{1,3})\b/;
const POKEMON_REJECT = /\b\d{1,3}\s*HP\b|\bHP\s*\d{1,3}\b/i;

const MTG_BODY =
  /\b(whenever|target|creature|instant|sorcery|enchantment|artifact|planeswalker|destroy|exile|counter|draw a card|mana|flying|trample|haste|vigilance|hexproof|enter(s|ed)? the battlefield)\b/i;
const MTG_COPY =
  /\b(copyright|©|\(c\)|wizards of the coast|wizards|hasbro|magic the gathering)\b/i;
const MTG_PRODUCT =
  /\b(magic|mtg|alpha|beta|unlimited|revised|core set|commander|modern|legacy|mythic|rare|uncommon)\b/i;
const MTG_LABELED = /(?:no\.?|#)\s*(\d{1,3}(?:\/\d{1,3})?)\b/i;
const MTG_NUMBER = /\b([A-Z]{3}[-\s]?\d{1,3}|\d{1,3}\/\d{2,3})\b/;
const MTG_REJECT = /\b([1-9]|1[0-5])\/([1-9]|1[0-5])\b/;

const OP_BODY =
  /\b(don!!|don |life|power|counter|trigger|block|your leader|your character|rest this|ko this|give this)\b/i;
const OP_COPY =
  /\b(copyright|©|\(c\)|bandai|fuji television|shueisha|toei|one piece)\b/i;
const OP_PRODUCT =
  /\b(one piece|bandai|romance dawn|paramount war|pillars of strength|awakening|leader|character|event|stage)\b/i;
const OP_LABELED = /(?:no\.?|#)\s*((?:OP|ST|EB|PR|P)\d{1,2}-\d{3})\b/i;
const OP_NUMBER = /\b((?:OP|ST|EB|PR|P)\d{1,2}-\d{3})\b/i;
const OP_REJECT = /\b(life|power|don)\s*\d{1,4}\b/i;

const TCG_GENERIC_BODY = new RegExp(
  `${POKEMON_BODY.source}|${MTG_BODY.source}|${OP_BODY.source}`,
  "i",
);
const TCG_GENERIC_COPY =
  /\b(copyright|©|\(c\)|the pokemon company|nintendo|wizards of the coast|bandai|one piece)\b/i;
const TCG_GENERIC_PRODUCT =
  /\b(pokemon|pok[eé]mon|magic|mtg|one piece|bandai|wizards|nintendo)\b/i;
const TCG_GENERIC_NUMBER = new RegExp(
  `${POKEMON_NUMBER.source}|${MTG_NUMBER.source}|${OP_NUMBER.source}`,
);
const TCG_GENERIC_REJECT = new RegExp(
  `${POKEMON_REJECT.source}|${MTG_REJECT.source}|${OP_REJECT.source}`,
  "i",
);

function tcgProfile(
  id: OcrProfileId,
  vertical: ScanVertical | null,
  category: ScanCategory,
  displayName: string,
  extras: Partial<
    Pick<
      OcrProfile,
      | "bodyMarkers"
      | "copyrightMarkers"
      | "productTokens"
      | "labeledNumber"
      | "collectorNumber"
      | "rejectAsNumber"
    >
  > = {},
): OcrProfile {
  return {
    id,
    family: "tcg",
    vertical,
    category,
    displayName,
    ruleOrModelVersion: OCR_PROFILE_RULE,
    tesseract: TCG_TES,
    title: TCG_TITLE,
    completeness: TCG_COMPLETE,
    bodyMarkers: extras.bodyMarkers ?? TCG_GENERIC_BODY,
    copyrightMarkers: extras.copyrightMarkers ?? TCG_GENERIC_COPY,
    productTokens: extras.productTokens ?? TCG_GENERIC_PRODUCT,
    labeledNumber: extras.labeledNumber ?? /(?:no\.?|#)\s*([A-Za-z0-9\/-]{1,12})\b/i,
    collectorNumber: extras.collectorNumber ?? TCG_GENERIC_NUMBER,
    rejectAsNumber: extras.rejectAsNumber ?? TCG_GENERIC_REJECT,
    teamTokens: null,
  };
}

export const OCR_PROFILES: Record<OcrProfileId, OcrProfile> = {
  sports_generic: sportsProfile("sports_generic", null, "Sports (generic)"),
  football: sportsProfile("football", "football", "Football", {
    body: FOOTBALL_BODY,
    team: FOOTBALL_TEAMS,
    product:
      /\b(panini|donruss|prizm|select|optic|mosaic|score|contenders|absolute|prestige|playoff|chronicles|certified|national\s+treasures|flawless|limited)\b/i,
  }),
  baseball: sportsProfile("baseball", "baseball", "Baseball", {
    body: BASEBALL_BODY,
    team: BASEBALL_TEAMS,
    product:
      /\b(topps|bowman|heritage|finest|stadium\s+club|chrome|gypsy|allen|ginter|upper\s*deck|fleer|leaf|prizm)\b/i,
  }),
  soccer: sportsProfile("soccer", "soccer", "Soccer", {
    body: SOCCER_BODY,
    team: SOCCER_TEAMS,
    product:
      /\b(panini|prizm|select|donruss|merlin|sticker|stickers|chronicles|optic|mosaic|topps)\b/i,
  }),
  basketball: sportsProfile("basketball", "basketball", "Basketball", {
    body: BASKETBALL_BODY,
    team: BASKETBALL_TEAMS,
    product:
      /\b(panini|prizm|select|optic|mosaic|hoops|donruss|chronicles|contenders|national\s+treasures|downtown|fleer|topps)\b/i,
  }),
  tcg_generic: tcgProfile("tcg_generic", null, "pokemon", "TCG (generic)"),
  pokemon: tcgProfile("pokemon", "pokemon", "pokemon", "Pokémon", {
    bodyMarkers: POKEMON_BODY,
    copyrightMarkers: POKEMON_COPY,
    productTokens: POKEMON_PRODUCT,
    labeledNumber: POKEMON_LABELED,
    collectorNumber: POKEMON_NUMBER,
    rejectAsNumber: POKEMON_REJECT,
  }),
  mtg: tcgProfile("mtg", "mtg", "mtg", "Magic: The Gathering", {
    bodyMarkers: MTG_BODY,
    copyrightMarkers: MTG_COPY,
    productTokens: MTG_PRODUCT,
    labeledNumber: MTG_LABELED,
    collectorNumber: MTG_NUMBER,
    rejectAsNumber: MTG_REJECT,
  }),
  one_piece: tcgProfile("one_piece", "one_piece", "one_piece", "One Piece", {
    bodyMarkers: OP_BODY,
    copyrightMarkers: OP_COPY,
    productTokens: OP_PRODUCT,
    labeledNumber: OP_LABELED,
    collectorNumber: OP_NUMBER,
    rejectAsNumber: OP_REJECT,
  }),
};

const HINT_TO_PROFILE: Record<ScanCategoryHint, OcrProfileId> = {
  sports: "sports_generic",
  sports_generic: "sports_generic",
  football: "football",
  baseball: "baseball",
  soccer: "soccer",
  basketball: "basketball",
  tcg: "tcg_generic",
  tcg_generic: "tcg_generic",
  pokemon: "pokemon",
  mtg: "mtg",
  one_piece: "one_piece",
};

export function getOcrProfile(id: OcrProfileId): OcrProfile {
  return OCR_PROFILES[id];
}

export function defaultOcrProfile(): OcrProfile {
  return OCR_PROFILES.sports_generic;
}

/**
 * Operator hint wins. Unknown / empty → sports generic (today's default lot)
 * with source=default so it is never stored as a verified vertical.
 */
export function resolveScanProfileHint(
  hint: string | null | undefined,
  source: ResolvedScanProfile["source"] = "operator",
): ResolvedScanProfile {
  const key = (hint ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const parsed = ScanCategoryHintSchema.safeParse(key);
  if (!parsed.success) {
    const profile = OCR_PROFILES.sports_generic;
    return ResolvedScanProfileSchema.parse({
      profileId: profile.id,
      family: profile.family,
      vertical: profile.vertical,
      category: profile.category,
      source: hint ? source : "default",
      confidence: hint ? 0.2 : 0.4,
    });
  }
  const profile = OCR_PROFILES[HINT_TO_PROFILE[parsed.data]];
  return ResolvedScanProfileSchema.parse({
    profileId: profile.id,
    family: profile.family,
    vertical: profile.vertical,
    category: profile.category,
    source: hint ? source : "default",
    confidence: source === "operator" ? 0.95 : 0.55,
  });
}

const DETECT_RULES: Array<{
  vertical: ScanVertical;
  profileId: OcrProfileId;
  re: RegExp;
  confidence: number;
}> = [
  { vertical: "one_piece", profileId: "one_piece", re: /\b(one\s*piece|op\d{2}-\d{3}|st\d{2}-\d{3}|don!!|bandai)\b/i, confidence: 0.72 },
  { vertical: "pokemon", profileId: "pokemon", re: /\b(pokemon|pok[eé]mon|pikachu|charizard|the pokemon company|\d{1,3}\s*hp)\b/i, confidence: 0.7 },
  { vertical: "mtg", profileId: "mtg", re: /\b(magic the gathering|\bmtg\b|wizards of the coast|planeswalker|mana cost)\b/i, confidence: 0.7 },
  { vertical: "football", profileId: "football", re: /\b(football|nfl|super bowl|quarterback|touchdown)\b/i, confidence: 0.62 },
  { vertical: "baseball", profileId: "baseball", re: /\b(baseball|mlb|world series|batting average)\b/i, confidence: 0.62 },
  { vertical: "soccer", profileId: "soccer", re: /\b(soccer|football club|premier league|fifa|la liga)\b/i, confidence: 0.6 },
  { vertical: "basketball", profileId: "basketball", re: /\b(basketball|nba|all[- ]nba|hoops)\b/i, confidence: 0.62 },
];

/**
 * Infer a vertical from OCR/filename tokens. Result is inferred · unverified —
 * never treated as an operator-confirmed profile.
 */
export function detectVerticalFromText(raw: string): ResolvedScanProfile | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  for (const rule of DETECT_RULES) {
    if (rule.re.test(text)) {
      const profile = OCR_PROFILES[rule.profileId];
      return ResolvedScanProfileSchema.parse({
        profileId: profile.id,
        family: profile.family,
        vertical: profile.vertical,
        category: profile.category,
        source: "inferred",
        confidence: rule.confidence,
      });
    }
  }
  return null;
}

/**
 * Operator hint is authoritative. If the hint is only a family
 * (`sports` / `tcg`) and the text names a vertical, refine — still inferred.
 */
export function resolveOcrProfile(input: {
  hint?: string | null;
  evidenceText?: string | null;
}): { profile: OcrProfile; resolved: ResolvedScanProfile } {
  const hinted = resolveScanProfileHint(input.hint, input.hint ? "operator" : "default");
  const profile = getOcrProfile(hinted.profileId);
  const genericFamily =
    hinted.profileId === "sports_generic" || hinted.profileId === "tcg_generic";
  if (genericFamily && input.evidenceText) {
    const detected = detectVerticalFromText(input.evidenceText);
    if (
      detected &&
      detected.family === profile.family &&
      detected.vertical
    ) {
      return { profile: getOcrProfile(detected.profileId), resolved: detected };
    }
  }
  return { profile, resolved: hinted };
}

export function inventoryCategoryFor(
  hint: string | null | undefined,
): ScanCategory {
  return resolveScanProfileHint(hint).category;
}

export const OCR_PROFILE_OPTIONS: Array<{
  id: ScanCategoryHint;
  label: string;
  family: ScanFamily | "any";
}> = [
  { id: "sports", label: "Sports (generic)", family: "sports" },
  { id: "football", label: "Football", family: "sports" },
  { id: "baseball", label: "Baseball", family: "sports" },
  { id: "soccer", label: "Soccer", family: "sports" },
  { id: "basketball", label: "Basketball", family: "sports" },
  { id: "pokemon", label: "Pokémon", family: "tcg" },
  { id: "mtg", label: "Magic: The Gathering", family: "tcg" },
  { id: "one_piece", label: "One Piece", family: "tcg" },
];
