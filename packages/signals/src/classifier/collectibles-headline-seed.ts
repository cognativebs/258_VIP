/**
 * collectibles-headline@0.1.0 (2026-10-01): comics, Pokémon/TCG, grading
 * companies and collector commentary. Every number is a starting guess ·
 * unverified. Migration 20261001_03 embeds this exact object; a test fails if
 * the two drift. The job reads the database row, not this constant.
 */
import type { ClassifierRuleSet } from "./sports-headline.js";

export const COLLECTIBLES_HEADLINE_RULES_SEED: ClassifierRuleSet = {
  schema: "vip_signals_classifier_rules_v1",
  classifier: "collectibles-headline",
  version: "0.1.0",
  domain: "collectibles",
  llm: {
    brief: [
      "You classify one collectibles news headline (comics, Pokémon and other TCGs, grading companies, collector commentary) for a collector who buys, grades and sells.",
      "A signal is a concrete event that can change the supply, demand or value of a specific product, set, comic, character or grading service; otherwise signalType is NONE.",
      "Reviews, previews, interviews, listicles, giveaways and opinion without a concrete event are NONE.",
    ].join("\n"),
    subjectKinds: ["product", "character", "creator", "company"],
  },
  scoring: { hedgeFactor: 0.8, singleSourceNoise: 0.3, rulesConfidence: 0.6 },
  noisePatterns: [
    "\\breviews?\\b",
    "\\bpreviews?\\b",
    "\\binterviews?\\b",
    "\\bpodcast\\b",
    "\\bpull list\\b",
    "\\bwhat to read\\b",
    "\\broundup\\b",
    "\\bpicks? of the week\\b",
    "\\brank(ing|ings)?\\b",
    "\\bbest (of|comics|cards|sets)\\b",
    "\\bgift guide\\b",
    "\\bgiveaway\\b",
    "\\bsponsored\\b",
    "\\bcosplay\\b",
    "\\bquiz\\b",
    "\\bpack opening\\b",
    "\\bunboxing\\b",
  ],
  hedgePatterns: [
    "\\bsources?\\b",
    "\\breports?\\b",
    "\\breportedly\\b",
    "\\brumou?rs?\\b",
    "\\bleak(ed|s)?\\b",
    "\\bexpected to\\b",
    "\\blikely\\b",
    "\\bTBD\\b",
    "\\bplans? to\\b",
  ],
  rules: [
    {
      type: "GRADING_SERVICE_CHANGE",
      patterns: [
        "\\b(PSA|TAG|CGC|BGS|Beckett|SGC)\\b.*\\b(price|prices|pricing|fees?|turnaround|service levels?|submissions?|raises?|cuts?|pauses?|suspends?|launch(es)?)\\b",
        "\\bgrading (price|prices|fees?|turnaround|service)\\b",
      ],
      excludePatterns: [],
    },
    {
      type: "REPRINT",
      patterns: ["\\breprint", "\\bsecond print(ing)?\\b", "\\b2nd print(ing)?\\b", "\\bback in print\\b"],
      excludePatterns: [],
    },
    {
      type: "RESTOCK",
      patterns: ["\\brestock", "\\bback in stock\\b", "\\bpre-?orders? (open|live|now)\\b", "\\bdrops? (today|tomorrow|this week)\\b"],
      excludePatterns: [],
    },
    {
      type: "SUPPLY_CHANGE",
      patterns: [
        "\\b(delay(ed|s)?|postponed|cancel(l)?ed|cancels)\\b",
        "\\ballocation\\b",
        "\\bshortages?\\b",
        "\\bprint runs?\\b",
        "\\blimited to \\d",
        "\\bout of print\\b",
      ],
      excludePatterns: [],
    },
    {
      type: "MEDIA_ADAPTATION",
      patterns: [
        "\\b(movie|film|tv series|television|series order|streaming|netflix|disney\\+|hbo|animated series|live-action)\\b",
        "\\bcast(s|ing)? as\\b",
        "\\b(greenlit|greenlights|optioned)\\b",
      ],
      excludePatterns: [],
    },
    {
      type: "SET_RELEASE",
      patterns: [
        "\\b(revealed|announced|unveiled|announces|reveals)\\b.*\\b(set|expansion|series|collection|product|box|comic|title)\\b",
        "\\brelease date\\b",
        "\\bnew (set|expansion|series|ongoing)\\b",
        "\\bsolicitations?\\b",
        "\\bvariant covers?\\b",
      ],
      excludePatterns: [],
    },
    {
      type: "AUCTION_RESULT",
      patterns: [
        "\\bsells? for \\$",
        "\\bsold for \\$",
        "\\brecord(-breaking)?\\b.*\\b(sale|auction|sold)\\b",
        "\\bauction\\b.*\\$[\\d,.]+",
      ],
      excludePatterns: [],
    },
    {
      type: "LICENSE_CHANGE",
      patterns: ["\\blicen[sc]e[sd]?\\b", "\\bpublishing rights\\b", "\\bmoves to\\b.*\\b(publisher|imprint)\\b"],
      excludePatterns: [],
    },
  ],
  injurySeverity: { season: [], weeks: [], day: [] },
  types: {
    GRADING_SERVICE_CHANGE: { direction: "mixed", impact: { unknown: 0.35 } },
    REPRINT: { direction: "down", impact: { unknown: 0.4 } },
    RESTOCK: { direction: "down", impact: { unknown: 0.3 } },
    SUPPLY_CHANGE: { direction: "mixed", impact: { unknown: 0.35 } },
    MEDIA_ADAPTATION: { direction: "up", impact: { unknown: 0.45 } },
    SET_RELEASE: { direction: "mixed", impact: { unknown: 0.3 } },
    AUCTION_RESULT: { direction: "up", impact: { unknown: 0.4 } },
    LICENSE_CHANGE: { direction: "mixed", impact: { unknown: 0.4 } },
  },
  notes:
    "Seed 0.1.0 · unverified (2026-10-01). Impacts, hedge factor, single-source noise and rules confidence are starting guesses, not measurements. Reprints and restocks read down for existing copies; media adaptations and record sales read up. Replace with a version calibrated from resolved predictions.",
};

const v010 = COLLECTIBLES_HEADLINE_RULES_SEED;
const v010Rule = (type: string) => v010.rules.find((r) => r.type === type)!;

/**
 * collectibles-headline@0.2.0 (2026-10-04): Pokémon TCG themes from the
 * operator's PokéBeach spec — card reveals, product reveals, preorders, pull
 * rates, promotions, competitive play. Preorders leave RESTOCK and get their
 * own theme. Rumour and leak language stays a hedge, not a theme. Migration
 * 20261004_01 embeds this object and makes it current; 0.1.0 stays for
 * provenance. New impacts are starting guesses · unverified.
 */
export const COLLECTIBLES_HEADLINE_RULES_V0_2_0: ClassifierRuleSet = {
  ...v010,
  version: "0.2.0",
  rules: [
    v010Rule("GRADING_SERVICE_CHANGE"),
    v010Rule("REPRINT"),
    {
      type: "PULL_RATE",
      patterns: ["\\bpull rates?\\b", "\\bodds of pulling\\b"],
      excludePatterns: [],
    },
    {
      type: "PREORDER",
      patterns: ["\\bpre-?orders?\\b"],
      excludePatterns: [],
    },
    {
      ...v010Rule("RESTOCK"),
      patterns: v010Rule("RESTOCK").patterns.filter((p) => !p.includes("pre-?orders?")),
    },
    v010Rule("SUPPLY_CHANGE"),
    {
      type: "PROMOTION",
      patterns: ["\\bpromotion\\b", "\\bmcdonald'?s\\b", "\\bhappy meal\\b"],
      excludePatterns: [],
    },
    {
      type: "COMPETITIVE",
      patterns: [
        "\\b(regionals?|internationals?|nationals|worlds|world championships?|tournaments?|top cut)\\b",
        "\\bbest play\\b",
        "\\bdeck ?lists?\\b",
        "\\bmeta\\b",
      ],
      excludePatterns: [],
    },
    {
      type: "CARD_REVEAL",
      patterns: ["\\bcard images?\\b", "\\bcards? revealed\\b", "\\brevealed\\b.*\\bcards?\\b", "\\bcards?\\b.*\\brevealed\\b"],
      excludePatterns: [],
    },
    {
      type: "PRODUCT_REVEAL",
      patterns: [
        "\\b(elite trainer box(es)?|etbs?|booster box(es)?|booster bundles?|collections?|tins?|binders?|blisters?|accessor(y|ies)|playmats?|sleeves)\\b.*\\b(revealed|announced|unveiled|to release|releasing|released)\\b",
        "\\b(revealed|announced|unveiled)\\b.*\\b(elite trainer box(es)?|etbs?|booster box(es)?|booster bundles?|collections?|tins?|binders?)\\b",
      ],
      excludePatterns: [],
    },
    v010Rule("MEDIA_ADAPTATION"),
    {
      ...v010Rule("SET_RELEASE"),
      patterns: [
        ...v010Rule("SET_RELEASE").patterns,
        "\\b(to release|releasing|launch(es|ing)?)\\b.*\\bsets?\\b",
        "\\bsets?\\b.*\\b(to release|releasing|launch(es|ing)?)\\b",
      ],
    },
    v010Rule("AUCTION_RESULT"),
    v010Rule("LICENSE_CHANGE"),
  ],
  types: {
    ...v010.types,
    CARD_REVEAL: { direction: "up", impact: { unknown: 0.25 } },
    PRODUCT_REVEAL: { direction: "mixed", impact: { unknown: 0.3 } },
    PREORDER: { direction: "mixed", impact: { unknown: 0.3 } },
    PULL_RATE: { direction: "mixed", impact: { unknown: 0.4 } },
    PROMOTION: { direction: "mixed", impact: { unknown: 0.2 } },
    COMPETITIVE: { direction: "mixed", impact: { unknown: 0.1 } },
  },
  notes:
    "0.2.0 · unverified (2026-10-04). Adds Pokémon TCG themes (card reveal, product reveal, preorder, pull rate, promotion, competitive); preorders are no longer restocks. Competitive news carries little collector impact. All numbers are starting guesses, not measurements.",
};
