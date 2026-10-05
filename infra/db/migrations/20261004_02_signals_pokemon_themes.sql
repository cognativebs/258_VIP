-- Pokémon TCG themes (2026-10-04, from the operator's PokéBeach spec categories).
-- 1. Signal types CARD_REVEAL, PRODUCT_REVEAL, PREORDER, PULL_RATE, PROMOTION, COMPETITIVE.
--    Half-lives are starting guesses · unverified. The spec's other categories map onto existing
--    types (release dates → SET_RELEASE; supply, allocation, scarcity, print run → SUPPLY_CHANGE;
--    rumour and leak → hedge); sentiment categories wait for member activity.
-- 2. collectibles-headline@0.2.0 becomes current, only while 0.1.0 is current, so a re-run never
--    reverts a later version. Preorders leave RESTOCK; "set ... to release" reads as SET_RELEASE.
-- Re-runnable. No vault_market.

BEGIN;

SET search_path TO vault_signals, vault_core, public;

INSERT INTO vault_signals.signal_type
  (code, display_name, default_half_life_hours, description, half_life_verified)
VALUES
  ('CARD_REVEAL', 'Card reveal', 168,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('PRODUCT_REVEAL', 'Product reveal', 720,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('PREORDER', 'Preorder', 168,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('PULL_RATE', 'Pull rate', 720,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('PROMOTION', 'Promotion', 336,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('COMPETITIVE', 'Competitive', 168,
   'Starting guess · unverified. Not a measured half-life.', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO vault_core.signals_classifier_rule_set (name, version, domain, rules_json, verified, is_current)
VALUES (
  'collectibles-headline',
  '0.2.0',
  'collectibles',
  $rules${
  "schema": "vip_signals_classifier_rules_v1",
  "classifier": "collectibles-headline",
  "version": "0.2.0",
  "domain": "collectibles",
  "llm": {
    "brief": "You classify one collectibles news headline (comics, Pokémon and other TCGs, grading companies, collector commentary) for a collector who buys, grades and sells.\nA signal is a concrete event that can change the supply, demand or value of a specific product, set, comic, character or grading service; otherwise signalType is NONE.\nReviews, previews, interviews, listicles, giveaways and opinion without a concrete event are NONE.",
    "subjectKinds": [
      "product",
      "character",
      "creator",
      "company"
    ]
  },
  "scoring": {
    "hedgeFactor": 0.8,
    "singleSourceNoise": 0.3,
    "rulesConfidence": 0.6
  },
  "noisePatterns": [
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
    "\\bunboxing\\b"
  ],
  "hedgePatterns": [
    "\\bsources?\\b",
    "\\breports?\\b",
    "\\breportedly\\b",
    "\\brumou?rs?\\b",
    "\\bleak(ed|s)?\\b",
    "\\bexpected to\\b",
    "\\blikely\\b",
    "\\bTBD\\b",
    "\\bplans? to\\b"
  ],
  "rules": [
    {
      "type": "GRADING_SERVICE_CHANGE",
      "patterns": [
        "\\b(PSA|TAG|CGC|BGS|Beckett|SGC)\\b.*\\b(price|prices|pricing|fees?|turnaround|service levels?|submissions?|raises?|cuts?|pauses?|suspends?|launch(es)?)\\b",
        "\\bgrading (price|prices|fees?|turnaround|service)\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "REPRINT",
      "patterns": [
        "\\breprint",
        "\\bsecond print(ing)?\\b",
        "\\b2nd print(ing)?\\b",
        "\\bback in print\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "PULL_RATE",
      "patterns": [
        "\\bpull rates?\\b",
        "\\bodds of pulling\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "PREORDER",
      "patterns": [
        "\\bpre-?orders?\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "RESTOCK",
      "patterns": [
        "\\brestock",
        "\\bback in stock\\b",
        "\\bdrops? (today|tomorrow|this week)\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "SUPPLY_CHANGE",
      "patterns": [
        "\\b(delay(ed|s)?|postponed|cancel(l)?ed|cancels)\\b",
        "\\ballocation\\b",
        "\\bshortages?\\b",
        "\\bprint runs?\\b",
        "\\blimited to \\d",
        "\\bout of print\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "PROMOTION",
      "patterns": [
        "\\bpromotion\\b",
        "\\bmcdonald'?s\\b",
        "\\bhappy meal\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "COMPETITIVE",
      "patterns": [
        "\\b(regionals?|internationals?|nationals|worlds|world championships?|tournaments?|top cut)\\b",
        "\\bbest play\\b",
        "\\bdeck ?lists?\\b",
        "\\bmeta\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "CARD_REVEAL",
      "patterns": [
        "\\bcard images?\\b",
        "\\bcards? revealed\\b",
        "\\brevealed\\b.*\\bcards?\\b",
        "\\bcards?\\b.*\\brevealed\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "PRODUCT_REVEAL",
      "patterns": [
        "\\b(elite trainer box(es)?|etbs?|booster box(es)?|booster bundles?|collections?|tins?|binders?|blisters?|accessor(y|ies)|playmats?|sleeves)\\b.*\\b(revealed|announced|unveiled|to release|releasing|released)\\b",
        "\\b(revealed|announced|unveiled)\\b.*\\b(elite trainer box(es)?|etbs?|booster box(es)?|booster bundles?|collections?|tins?|binders?)\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "MEDIA_ADAPTATION",
      "patterns": [
        "\\b(movie|film|tv series|television|series order|streaming|netflix|disney\\+|hbo|animated series|live-action)\\b",
        "\\bcast(s|ing)? as\\b",
        "\\b(greenlit|greenlights|optioned)\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "SET_RELEASE",
      "patterns": [
        "\\b(revealed|announced|unveiled|announces|reveals)\\b.*\\b(set|expansion|series|collection|product|box|comic|title)\\b",
        "\\brelease date\\b",
        "\\bnew (set|expansion|series|ongoing)\\b",
        "\\bsolicitations?\\b",
        "\\bvariant covers?\\b",
        "\\b(to release|releasing|launch(es|ing)?)\\b.*\\bsets?\\b",
        "\\bsets?\\b.*\\b(to release|releasing|launch(es|ing)?)\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "AUCTION_RESULT",
      "patterns": [
        "\\bsells? for \\$",
        "\\bsold for \\$",
        "\\brecord(-breaking)?\\b.*\\b(sale|auction|sold)\\b",
        "\\bauction\\b.*\\$[\\d,.]+"
      ],
      "excludePatterns": []
    },
    {
      "type": "LICENSE_CHANGE",
      "patterns": [
        "\\blicen[sc]e[sd]?\\b",
        "\\bpublishing rights\\b",
        "\\bmoves to\\b.*\\b(publisher|imprint)\\b"
      ],
      "excludePatterns": []
    }
  ],
  "injurySeverity": {
    "season": [],
    "weeks": [],
    "day": []
  },
  "types": {
    "GRADING_SERVICE_CHANGE": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.35
      }
    },
    "REPRINT": {
      "direction": "down",
      "impact": {
        "unknown": 0.4
      }
    },
    "RESTOCK": {
      "direction": "down",
      "impact": {
        "unknown": 0.3
      }
    },
    "SUPPLY_CHANGE": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.35
      }
    },
    "MEDIA_ADAPTATION": {
      "direction": "up",
      "impact": {
        "unknown": 0.45
      }
    },
    "SET_RELEASE": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.3
      }
    },
    "AUCTION_RESULT": {
      "direction": "up",
      "impact": {
        "unknown": 0.4
      }
    },
    "LICENSE_CHANGE": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.4
      }
    },
    "CARD_REVEAL": {
      "direction": "up",
      "impact": {
        "unknown": 0.25
      }
    },
    "PRODUCT_REVEAL": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.3
      }
    },
    "PREORDER": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.3
      }
    },
    "PULL_RATE": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.4
      }
    },
    "PROMOTION": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.2
      }
    },
    "COMPETITIVE": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.1
      }
    }
  },
  "notes": "0.2.0 · unverified (2026-10-04). Adds Pokémon TCG themes (card reveal, product reveal, preorder, pull rate, promotion, competitive); preorders are no longer restocks. Competitive news carries little collector impact. All numbers are starting guesses, not measurements."
}$rules$::jsonb,
  false,
  false
)
ON CONFLICT (name, version) DO NOTHING;

UPDATE vault_core.signals_classifier_rule_set
   SET is_current = false
 WHERE name = 'collectibles-headline' AND version = '0.1.0' AND is_current;

UPDATE vault_core.signals_classifier_rule_set
   SET is_current = true
 WHERE name = 'collectibles-headline' AND version = '0.2.0'
   AND NOT EXISTS (
     SELECT 1 FROM vault_core.signals_classifier_rule_set WHERE name = 'collectibles-headline' AND is_current
   );

COMMIT;
