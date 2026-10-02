/**
 * macro-headline@0.1.0 (2026-10-01): US, world and business headlines read
 * for what moves a collector's costs, demand or channels — tariffs, shipping,
 * tax and marketplace rules, collectibles companies, markets and the economy.
 * Everything else is NONE. Every number is a starting guess · unverified.
 * Migration 20261001_04 embeds this exact object; a test fails if they drift.
 */
import type { ClassifierRuleSet } from "./sports-headline.js";

const COMPANIES =
  "(eBay|Hasbro|Mattel|Funko|GameStop|Fanatics|Topps|Panini|Upper Deck|Nintendo|Pok[eé]mon Company|Whatnot|Collectors Holdings|PSA|Beckett|CGC|Heritage Auctions|Goldin|Marvel|DC Comics|Diamond Comic|Lunar Distribution|Target|Walmart)";

export const MACRO_HEADLINE_RULES_SEED: ClassifierRuleSet = {
  schema: "vip_signals_classifier_rules_v1",
  classifier: "macro-headline",
  version: "0.1.0",
  domain: "macro",
  llm: {
    brief: [
      "You classify one US, world or business news headline for a collector who buys and sells comics, trading cards and sealed product, mostly in the US.",
      "A signal is a concrete event that can change the collector's costs (tariffs, shipping, taxes), demand (the economy, markets), or channels (marketplaces, publishers, card makers, retailers, grading companies); otherwise signalType is NONE.",
      "General politics, crime, weather, sport results and celebrity news are NONE unless they directly change one of those.",
    ].join("\n"),
    subjectKinds: ["company", "product", "other"],
  },
  scoring: { hedgeFactor: 0.8, singleSourceNoise: 0.3, rulesConfidence: 0.6 },
  noisePatterns: [
    "\\bpodcast\\b",
    "\\bquiz\\b",
    "\\bcrossword\\b",
    "\\bhoroscope",
    "\\brecipes?\\b",
    "\\bphotos?:",
    "\\bin pictures\\b",
    "^\\W*opinion\\b",
    "\\bop-ed\\b",
    "\\bletters? to the editor\\b",
    "\\bwatch live\\b",
    "\\bstocks? to buy\\b",
    "\\bbest stocks\\b",
  ],
  hedgePatterns: [
    "\\bsources?\\b",
    "\\breports?\\b",
    "\\breportedly\\b",
    "\\bexpected to\\b",
    "\\blikely\\b",
    "\\bcould\\b",
    "\\bconsiders?\\b",
    "\\bweighs?\\b",
    "\\bproposed?\\b",
    "\\bthreatens?\\b",
  ],
  rules: [
    {
      type: "COMPANY_EVENT",
      patterns: [
        `\\b${COMPANIES}\\b.*\\b(earnings|results|revenue|guidance|forecast|layoffs?|job cuts|acquires?|acquisition|merger|buys|bankrupt|bankruptcy|lawsuit|sues|sued|antitrust|IPO|CEO|recall|shuts?|closing|closes)\\b`,
        `\\b(earnings|results|guidance|layoffs?|acquires?|acquisition|bankruptcy|lawsuit|sues|IPO|CEO)\\b.*\\b${COMPANIES}\\b`,
      ],
      excludePatterns: [],
    },
    {
      type: "TRADE_POLICY",
      patterns: ["\\btariffs?\\b", "\\bde minimis\\b", "\\bcustoms dut(y|ies)\\b", "\\btrade (war|deal|talks)\\b", "\\bimport (ban|duties|taxes)\\b", "\\bexport controls?\\b"],
      excludePatterns: [],
    },
    {
      type: "SHIPPING_CHANGE",
      patterns: [
        "\\bUSPS\\b",
        "\\bpostal (rates?|service)\\b",
        "\\bpostage\\b",
        "\\bshipping (rates?|costs?|delays?)\\b",
        "\\bport (strike|closures?|congestion)\\b",
        "\\b(UPS|FedEx|DHL)\\b.*\\b(strike|rates?|surcharge)\\b",
      ],
      excludePatterns: [],
    },
    {
      type: "REGULATION",
      patterns: [
        "\\b1099-K\\b",
        "\\bsales tax\\b",
        "\\bmarketplace facilitator\\b",
        "\\bcollectibles tax\\b",
        "\\bcapital gains\\b.*\\bcollectibles?\\b",
        "\\bINFORM (Consumers )?Act\\b",
        "\\bFTC\\b.*\\b(rule|ban|marketplace|resale)\\b",
      ],
      excludePatterns: [],
    },
    {
      type: "MARKET_MOVE",
      patterns: [
        "\\b(Dow|S&P 500|Nasdaq|stocks|stock market|Wall Street)\\b.*\\b(plunge|plunges|surge|surges|tumble|tumbles|rally|rallies|slump|slumps|record|sell-?off|crash)",
        "\\b(gold|silver)\\b.*\\b(price|prices|record|surge|surges|plunge|plunges|hits|falls|rises|rally)",
        "\\b(bitcoin|crypto)\\b.*\\b(record|plunge|plunges|surge|surges|crash)",
      ],
      excludePatterns: [],
    },
    {
      type: "MACRO_TREND",
      patterns: [
        "\\binflation\\b",
        "\\brecession\\b",
        "\\binterest rates?\\b",
        "\\bFed(eral Reserve)?\\b.*\\b(raises|cuts|holds|hike|cut|pause)\\b",
        "\\bjobs report\\b",
        "\\bunemployment\\b",
        "\\bconsumer (spending|confidence|sentiment)\\b",
        "\\bGDP\\b",
        "\\bretail sales\\b",
      ],
      excludePatterns: [],
    },
  ],
  injurySeverity: { season: [], weeks: [], day: [] },
  types: {
    COMPANY_EVENT: { direction: "mixed", impact: { unknown: 0.35 } },
    TRADE_POLICY: { direction: "mixed", impact: { unknown: 0.35 } },
    SHIPPING_CHANGE: { direction: "mixed", impact: { unknown: 0.3 } },
    REGULATION: { direction: "mixed", impact: { unknown: 0.3 } },
    MARKET_MOVE: { direction: "mixed", impact: { unknown: 0.2 } },
    MACRO_TREND: { direction: "mixed", impact: { unknown: 0.25 } },
  },
  notes:
    "Seed 0.1.0 · unverified (2026-10-01). Directions are mixed because the same headline can help or hurt a collector; impacts are small because these are indirect. Starting guesses, not measurements. A headline about a price is news, never a price.",
};
