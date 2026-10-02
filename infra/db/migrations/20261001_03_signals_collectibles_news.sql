-- SIGNALS collectibles news (2026-10-01, Greg: "collectibles news first").
-- 1. News source rows: PokeBeach, PSA announcements, TAG announcements, Alpha
--    Investments (YouTube). ComicsBeat already exists (20260920_06). Every row is
--    disabled with endpoint and terms unverified (HS-5). News sources only (HS-3):
--    grading pop reports, marketplaces and prices are market data, not here.
-- 2. Signal types MEDIA_ADAPTATION and GRADING_SERVICE_CHANGE (half-lives unverified).
-- 3. Classifier rule set collectibles-headline@0.1.0 · unverified, current.
-- 4. Curation profile daily-collectibles@0.1.0 · unverified, current.
-- Re-runnable. No vault_market. No source row is enabled.

BEGIN;

SET search_path TO vault_core, vault_signals, public;

INSERT INTO vault_core.signals_news_source (
  source_key, display_name, tier, access_method, endpoint, auth, verify_before_first_run, adapter_enabled, is_active,
  blocked_reason, cadence, category_coverage, seed_evidence_class, seed_confidence_ceiling, authority_seed,
  redistribution_allowed, may_raise_valuation_ceiling, terms, dedup_keys, iqvault_only, why_it_earns_a_slot,
  prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
) VALUES
  ('pokebeach_rss', 'PokeBeach', 'machine', 'rss', NULL, 'none', true, false, false,
   'endpoint and terms unverified: confirm the official feed URL and PokeBeach terms before enabling', 'several daily', ARRAY['pokemon']::text[], 'trade_press', 0.550, 0.600,
   false, false, 'Unverified. Confirm PokeBeach''s published feed and terms before enabling. Store title, link, timestamp and summary only; never article bodies or images.', ARRAY['guid','url_canonical']::text[], true, 'Pokémon TCG set reveals, release dates and product news; also reports retail drops. Never a price authority.',
   'signals_news_seed', 'inferred', 'signals-news-source@0.2.0', 0.550, 'unverified',
   'Added 2026-10-01 (collectibles news). authority_seed and confidence ceiling are seed estimates · unverified. Adapter off.'),
  ('psa_news', 'PSA announcements', 'machine', 'rss_or_scrape_check', NULL, 'none', true, false, false,
   'no published feed confirmed; do not scrape', 'irregular', ARRAY['grading', 'sports_cards', 'pokemon', 'comics']::text[], 'company_primary', 0.850, 0.850,
   false, false, 'Unverified. No published PSA news feed confirmed. Do not scrape.', ARRAY['guid','url_canonical']::text[], true, 'Primary source for PSA''s own pricing, turnaround and service changes, which move grading economics.',
   'signals_news_seed', 'inferred', 'signals-news-source@0.2.0', 0.850, 'unverified',
   'Added 2026-10-01 (collectibles news). authority_seed and confidence ceiling are seed estimates · unverified. Adapter off.'),
  ('tag_news', 'TAG Grading announcements', 'machine', 'rss_or_scrape_check', NULL, 'none', true, false, false,
   'no published feed confirmed; do not scrape', 'irregular', ARRAY['grading', 'sports_cards', 'pokemon']::text[], 'company_primary', 0.800, 0.800,
   false, false, 'Unverified. No published TAG news feed confirmed. Do not scrape.', ARRAY['guid','url_canonical']::text[], true, 'Primary source for TAG''s own pricing and service changes.',
   'signals_news_seed', 'inferred', 'signals-news-source@0.2.0', 0.800, 'unverified',
   'Added 2026-10-01 (collectibles news). authority_seed and confidence ceiling are seed estimates · unverified. Adapter off.'),
  ('alpha_investments_youtube', 'Alpha Investments (YouTube)', 'machine', 'rss', NULL, 'none', true, false, false,
   'channel ID and YouTube terms unverified', 'weekly', ARRAY['pokemon', 'collectibles_general']::text[], 'creator_opinion', 0.300, 0.350,
   false, false, 'Unverified. YouTube channel Atom feed (youtube.com/feeds/videos.xml?channel_id=...); channel ID not yet confirmed. YouTube Terms of Service apply: titles, links, publish time and description only; no video download.', ARRAY['guid','url_canonical']::text[], true, 'Collector-market commentary. Opinion, recorded with provenance method opinion and the lowest confidence ceiling.',
   'signals_news_seed', 'inferred', 'signals-news-source@0.2.0', 0.300, 'unverified',
   'Added 2026-10-01 (collectibles news). authority_seed and confidence ceiling are seed estimates · unverified. Adapter off.')
ON CONFLICT (source_key) DO NOTHING;

INSERT INTO vault_signals.signal_type
  (code, display_name, default_half_life_hours, description, half_life_verified)
VALUES
  ('MEDIA_ADAPTATION', 'Media adaptation', 720,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('GRADING_SERVICE_CHANGE', 'Grading service change', 720,
   'Starting guess · unverified. Not a measured half-life.', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO vault_core.signals_classifier_rule_set (name, version, domain, rules_json, verified, is_current)
SELECT
  'collectibles-headline',
  '0.1.0',
  'collectibles',
  $rules${
  "schema": "vip_signals_classifier_rules_v1",
  "classifier": "collectibles-headline",
  "version": "0.1.0",
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
      "type": "RESTOCK",
      "patterns": [
        "\\brestock",
        "\\bback in stock\\b",
        "\\bpre-?orders? (open|live|now)\\b",
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
        "\\bvariant covers?\\b"
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
    }
  },
  "notes": "Seed 0.1.0 · unverified (2026-10-01). Impacts, hedge factor, single-source noise and rules confidence are starting guesses, not measurements. Reprints and restocks read down for existing copies; media adaptations and record sales read up. Replace with a version calibrated from resolved predictions."
}$rules$::jsonb,
  false,
  NOT EXISTS (SELECT 1 FROM vault_core.signals_classifier_rule_set WHERE name = 'collectibles-headline' AND is_current)
ON CONFLICT (name, version) DO NOTHING;

INSERT INTO vault_core.signals_curation_profile (name, version, domain, profile_json, verified, is_current)
SELECT
  'daily-collectibles',
  '0.1.0',
  'collectibles',
  $profile${
  "schema": "vip_signals_curation_v1",
  "name": "daily-collectibles",
  "version": "0.1.0",
  "domain": "collectibles",
  "slots": 20,
  "windowHours": 24,
  "groups": [
    {
      "key": "comics",
      "label": "Comics",
      "share": 0.4,
      "lanes": [
        "comicsbeat_rss"
      ],
      "stance": "collect"
    },
    {
      "key": "pokemon",
      "label": "Pokémon / TCG",
      "share": 0.35,
      "lanes": [
        "pokebeach_rss"
      ],
      "stance": "collect"
    },
    {
      "key": "grading",
      "label": "Grading (PSA, TAG)",
      "share": 0.15,
      "lanes": [
        "psa_news",
        "tag_news"
      ],
      "stance": "collect"
    },
    {
      "key": "creator",
      "label": "Creator commentary",
      "share": 0.1,
      "lanes": [
        "alpha_investments_youtube"
      ],
      "stance": "collect"
    }
  ],
  "backfillOrder": [
    "comics",
    "pokemon",
    "grading"
  ],
  "notes": "Starting shares 2026-10-01 (comics 40, Pokémon 35, grading 15, creator commentary 10) · unverified. Shares choose slots only; they never change a signal's scores. Creator commentary is opinion and is never backfilled into."
}$profile$::jsonb,
  false,
  NOT EXISTS (SELECT 1 FROM vault_core.signals_curation_profile WHERE name = 'daily-collectibles' AND is_current)
ON CONFLICT (name, version) DO NOTHING;

COMMIT;
