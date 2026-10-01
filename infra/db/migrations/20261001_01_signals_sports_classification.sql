-- SIGNALS sports headline classification (2026-10-01, Greg; decisions 2026-09-27).
-- 1. vault_core.signals_classifier_rule_set: versioned classifier rules and scores
--    (a registry, so vault_core per ADR 0013 G-4). One current row per classifier.
-- 2. vault_signals.event_evidence.item_ref: the item inside a multi-item document
--    (an RSS guid), so a signal points at one headline, not a whole feed snapshot.
-- 3. Six sports signal types. Half-lives are starting guesses · unverified.
-- 4. Seed rule set sports-headline@0.1.0 · unverified. rules_json must equal
--    SPORTS_HEADLINE_RULES_SEED (packages/signals); a test fails if they drift.
-- Re-runnable. No vault_market. No priced_unit. No source row is enabled.

BEGIN;

SET search_path TO vault_core, vault_signals, public;

CREATE TABLE IF NOT EXISTS vault_core.signals_classifier_rule_set (
    id            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    name          TEXT NOT NULL,
    version       TEXT NOT NULL,
    domain        TEXT NOT NULL,
    rules_json    JSONB NOT NULL,
    verified      BOOLEAN NOT NULL DEFAULT false,
    is_current    BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signals_classifier_rule_set_version_unique UNIQUE (name, version),
    CONSTRAINT signals_classifier_rule_set_identity CHECK (
      rules_json->>'classifier' = name AND rules_json->>'version' = version AND rules_json->>'domain' = domain
    )
);

COMMENT ON TABLE vault_core.signals_classifier_rule_set IS
  'Versioned classifier rules and scores (noise filter, keyword rules, per-type direction and impact, hedge factor, single-source noise). Application code reads the current row and never hardcodes a score. verified stays false until resolved predictions calibrate a new version. A new version is a new row; old rows stay for provenance.';

CREATE UNIQUE INDEX IF NOT EXISTS signals_classifier_rule_set_one_current
  ON vault_core.signals_classifier_rule_set (name)
  WHERE is_current;

ALTER TABLE vault_signals.event_evidence
  ADD COLUMN IF NOT EXISTS item_ref TEXT
    CHECK (item_ref IS NULL OR octet_length(item_ref) BETWEEN 1 AND 1024);

COMMENT ON COLUMN vault_signals.event_evidence.item_ref IS
  'The item inside a multi-item document (an RSS guid). NULL when the whole document is the evidence.';

INSERT INTO vault_signals.signal_type
  (code, display_name, default_half_life_hours, description, half_life_verified)
VALUES
  ('PLAYER_DEATH', 'Player death', 336,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('MILESTONE', 'Milestone', 720,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('TRANSACTION', 'Transaction', 336,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('AWARD_RACE', 'Award race', 720,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('DISCIPLINE', 'Discipline', 720,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('RETIREMENT', 'Retirement', 2160,
   'Starting guess · unverified. Not a measured half-life.', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO vault_core.signals_classifier_rule_set (name, version, domain, rules_json, verified, is_current)
SELECT
  'sports-headline',
  '0.1.0',
  'sports_cards',
  $rules${
  "schema": "vip_signals_classifier_rules_v1",
  "classifier": "sports-headline",
  "version": "0.1.0",
  "domain": "sports_cards",
  "scoring": {
    "hedgeFactor": 0.8,
    "singleSourceNoise": 0.3,
    "rulesConfidence": 0.6
  },
  "noisePatterns": [
    "\\brank(ing|ings)?\\b",
    "\\brerank",
    "\\bpredict",
    "\\bproject(ing|ions?|ed)\\b",
    "\\bodds\\b",
    "\\bbets?\\b",
    "\\bbetting\\b",
    "\\bfantasy\\b",
    "\\bmock draft\\b",
    "\\bgrad(es|ing)\\b",
    "\\bsleepers\\b",
    "\\bpreviews?\\b",
    "\\brecap\\b",
    "\\btiers\\b",
    "\\bbracketology\\b",
    "\\bbubble watch\\b",
    "\\bpoll\\b",
    "^\\W*follow live\\b",
    "\\bdraft (guide|board)\\b",
    "\\bbest of the rest\\b",
    "\\bbuzz\\b",
    "\\bkey questions\\b",
    "\\bwatch list\\b",
    "\\bbottom 10\\b",
    "\\bbreaking down\\b",
    "\\bplaybook\\b",
    "\\bplayoff picture\\b",
    "\\bknee-jerk\\b"
  ],
  "hedgePatterns": [
    "\\bsources?\\b",
    "\\breports?\\b",
    "\\bexpected to\\b",
    "\\blikely\\b",
    "\\bat risk\\b",
    "\\bTBD\\b",
    "\\bplans? to\\b",
    "\\bconsidered\\b"
  ],
  "rules": [
    {
      "type": "PLAYER_DEATH",
      "patterns": [
        "\\bdies\\b",
        "\\bdied\\b",
        "\\bdead at\\b",
        "\\bpasses away\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "PLAYER_INJURY",
      "patterns": [
        "\\binjur(y|ed|ies)\\b",
        "\\binjured list\\b",
        "\\bsprain",
        "\\bconcussion\\b",
        "\\btorn\\b",
        "\\bfracture",
        "\\bsurgery\\b",
        "\\bseason-ending\\b",
        "\\bloses .* for (the )?season\\b",
        "\\bto miss\\b",
        "\\bhospitalized\\b"
      ],
      "excludePatterns": [
        "\\bclears?\\b",
        "\\bcleared\\b",
        "\\breturns?\\b",
        "\\brecovered\\b"
      ]
    },
    {
      "type": "DISCIPLINE",
      "patterns": [
        "\\bsuspend(ed|s|sion)?\\b",
        "\\bfined\\b",
        "\\barrest(ed)?\\b",
        "\\bindict",
        "\\bbanned\\b",
        "\\bconduct detrimental\\b",
        "\\bcharged\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "RETIREMENT",
      "patterns": [
        "\\bretir(e|es|ed|ing|ement)\\b",
        "\\bhangs? up\\b",
        "\\bcalls? it a career\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "HOF_ANNOUNCEMENT",
      "patterns": [
        "\\bHall of Fame (class|inductee|induction|ballot)\\b",
        "\\binducted\\b",
        "\\belected to\\b.*\\bHall\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "MILESTONE",
      "patterns": [
        "\\b40[- /]?HR[- /]40[- /]?SB\\b",
        "\\bjoins?\\b.*\\bclub\\b",
        "\\bbecomes \\d+(st|nd|rd|th)\\b",
        "\\ball-time\\b",
        "\\bbreaks? .*record\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "TRANSACTION",
      "patterns": [
        "\\btraded?\\b",
        "\\bre-signs?\\b",
        "\\bsigns?\\b",
        "\\bdeal worth\\b",
        "\\b\\d+-year deal\\b",
        "\\b(gets|inks?|lands?) \\$[\\d.]+M deal\\b",
        "\\bextension\\b",
        "\\bwaived\\b",
        "\\breleased\\b",
        "\\bacquires?\\b"
      ],
      "excludePatterns": []
    },
    {
      "type": "AWARD_RACE",
      "patterns": [
        "\\bMVP\\b",
        "\\bCy Young\\b",
        "\\bHeisman\\b",
        "\\bCalder\\b",
        "\\bRookie of the Year\\b",
        "\\bbatting title\\b"
      ],
      "excludePatterns": []
    }
  ],
  "injurySeverity": {
    "season": [
      "\\bfor (the )?season\\b",
      "\\bseason-ending\\b",
      "\\brest of the season\\b",
      "\\bfor the year\\b"
    ],
    "weeks": [
      "\\bIL\\b",
      "\\binjured list\\b",
      "\\bweek[- ]to[- ]week\\b",
      "\\bextended time\\b",
      "\\bweeks\\b",
      "\\buntil\\b",
      "\\bmiss(ing)? (the )?start\\b"
    ],
    "day": [
      "\\bday[- ]to[- ]day\\b",
      "\\bleaves game\\b",
      "\\bleft (the |thursday's |\\w+'s )?game\\b",
      "\\bquestionable\\b"
    ]
  },
  "types": {
    "PLAYER_INJURY": {
      "direction": "down",
      "impact": {
        "unknown": 0.15,
        "day": 0.15,
        "weeks": 0.3,
        "season": 0.5
      }
    },
    "PLAYER_DEATH": {
      "direction": "up",
      "impact": {
        "unknown": 0.6
      }
    },
    "MILESTONE": {
      "direction": "up",
      "impact": {
        "unknown": 0.4
      }
    },
    "TRANSACTION": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.3
      }
    },
    "AWARD_RACE": {
      "direction": "up",
      "impact": {
        "unknown": 0.35
      }
    },
    "DISCIPLINE": {
      "direction": "down",
      "impact": {
        "unknown": 0.35
      }
    },
    "RETIREMENT": {
      "direction": "mixed",
      "impact": {
        "unknown": 0.3
      }
    },
    "HOF_ANNOUNCEMENT": {
      "direction": "up",
      "impact": {
        "unknown": 0.5
      }
    }
  },
  "notes": "Seed 0.1.0 · unverified. Impacts, hedge factor, single-source noise and rules confidence are starting guesses (operator-approved 2026-09-27), not measurements. Injury with unknown severity takes the smallest injury impact. Replace with a new version calibrated from resolved predictions."
}$rules$::jsonb,
  false,
  NOT EXISTS (SELECT 1 FROM vault_core.signals_classifier_rule_set WHERE name = 'sports-headline' AND is_current)
ON CONFLICT (name, version) DO NOTHING;

COMMIT;
