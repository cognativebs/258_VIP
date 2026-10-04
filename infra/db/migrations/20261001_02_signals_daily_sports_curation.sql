-- Daily Sports SIGNAL curation (2026-10-01, Greg).
-- 1. vault_core.signals_curation_profile: versioned shares that decide how many
--    of a day's slots each sport gets. Shares never change stored signal scores.
--    Seed daily-sports@0.1.0: 80% football (NFL + college), 10% soccer,
--    5% basketball (NBA), 5% baseball (MLB); basketball and baseball are exit
--    sports (the collector is selling out), so their up signals read as sell windows.
-- 2. vault_signals.event_evidence.source_item_url: the article link exactly as the
--    feed gave it (ESPN terms: link to the article with the feed's URL).
-- 3. sports-headline@0.2.0 (soccer terms) becomes the current classifier rule set,
--    but only while 0.1.0 is current, so a re-run never reverts a later version.
-- Re-runnable. No vault_market. No source row is enabled.

BEGIN;

SET search_path TO vault_core, vault_signals, public;

CREATE TABLE IF NOT EXISTS vault_core.signals_curation_profile (
    id            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    name          TEXT NOT NULL,
    version       TEXT NOT NULL,
    domain        TEXT NOT NULL,
    profile_json  JSONB NOT NULL,
    verified      BOOLEAN NOT NULL DEFAULT false,
    is_current    BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signals_curation_profile_version_unique UNIQUE (name, version),
    CONSTRAINT signals_curation_profile_identity CHECK (
      profile_json->>'name' = name AND profile_json->>'version' = version AND profile_json->>'domain' = domain
    )
);

COMMENT ON TABLE vault_core.signals_curation_profile IS
  'Versioned curation of a daily signals list: per-group slot shares, window, and stance (collect or exit). Read at request time; changing the current row changes tomorrow''s list and rewrites nothing. Shares are an operator preference, not a score, and never feed signal_priority.';

CREATE UNIQUE INDEX IF NOT EXISTS signals_curation_profile_one_current
  ON vault_core.signals_curation_profile (name)
  WHERE is_current;

ALTER TABLE vault_signals.event_evidence
  ADD COLUMN IF NOT EXISTS source_item_url TEXT
    CHECK (source_item_url IS NULL OR octet_length(source_item_url) BETWEEN 1 AND 2048);

COMMENT ON COLUMN vault_signals.event_evidence.source_item_url IS
  'The item''s link exactly as the source provided it (not normalized). Used to link displayed headlines back to the original article.';

INSERT INTO vault_core.signals_classifier_rule_set (name, version, domain, rules_json, verified, is_current)
VALUES (
  'sports-headline',
  '0.2.0',
  'sports_cards',
  $rules${
  "schema": "vip_signals_classifier_rules_v1",
  "classifier": "sports-headline",
  "version": "0.2.0",
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
    "\\bknee-jerk\\b",
    "\\brumou?rs?\\b",
    "\\bgossip\\b",
    "\\bplayer ratings\\b"
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
        "\\bhospitalized\\b",
        "\\bhamstring\\b",
        "\\bACL\\b"
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
        "\\bcharged\\b",
        "\\bred card\\b",
        "\\bsent off\\b"
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
        "\\bjoins?\\b.*\\d.*\\bclub\\b",
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
        "\\bacquires?\\b",
        "\\btransfer\\b",
        "\\bon loan\\b",
        "\\bloan move\\b",
        "(£|€)[\\d.]+m\\b"
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
        "\\bbatting title\\b",
        "\\bBallon d'Or\\b",
        "\\bGolden Boot\\b"
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
  "notes": "0.2.0 · unverified. Adds soccer terms (transfers, loans, red cards, hamstring/ACL, Ballon d'Or) and soccer rumour noise; a milestone 'club' now needs a number. Scores unchanged from 0.1.0, still starting guesses."
}$rules$::jsonb,
  false,
  false
)
ON CONFLICT (name, version) DO NOTHING;

UPDATE vault_core.signals_classifier_rule_set
   SET is_current = false
 WHERE name = 'sports-headline' AND version = '0.1.0' AND is_current;

UPDATE vault_core.signals_classifier_rule_set
   SET is_current = true
 WHERE name = 'sports-headline' AND version = '0.2.0'
   AND NOT EXISTS (
     SELECT 1 FROM vault_core.signals_classifier_rule_set WHERE name = 'sports-headline' AND is_current
   );

INSERT INTO vault_core.signals_curation_profile (name, version, domain, profile_json, verified, is_current)
SELECT
  'daily-sports',
  '0.1.0',
  'sports_cards',
  $profile${
  "schema": "vip_signals_curation_v1",
  "name": "daily-sports",
  "version": "0.1.0",
  "domain": "sports_cards",
  "slots": 20,
  "windowHours": 24,
  "groups": [
    {
      "key": "football",
      "label": "Football (NFL + college)",
      "share": 0.8,
      "lanes": [
        "nfl",
        "ncf"
      ],
      "stance": "collect"
    },
    {
      "key": "soccer",
      "label": "Soccer",
      "share": 0.1,
      "lanes": [
        "soccer"
      ],
      "stance": "collect"
    },
    {
      "key": "basketball",
      "label": "Basketball (NBA)",
      "share": 0.05,
      "lanes": [
        "nba"
      ],
      "stance": "exit"
    },
    {
      "key": "baseball",
      "label": "Baseball (MLB)",
      "share": 0.05,
      "lanes": [
        "mlb"
      ],
      "stance": "exit"
    }
  ],
  "backfillOrder": [
    "football",
    "soccer"
  ],
  "notes": "Operator weights 2026-10-01. Shares choose how many of the day's slots each sport gets; they never change a signal's scores. Slots a sport cannot fill go to football, then soccer; exit sports are not backfilled. Hockey and college basketball are outside the profile. Slot count and window are starting choices · unverified."
}$profile$::jsonb,
  false,
  NOT EXISTS (SELECT 1 FROM vault_core.signals_curation_profile WHERE name = 'daily-sports' AND is_current)
ON CONFLICT (name, version) DO NOTHING;

COMMIT;
