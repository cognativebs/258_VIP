-- GDELT radar (B1; operator decisions 2026-10-17). GDELT asked researchers to use its GDELT 5
-- downloadable Web NGrams instead of the overloaded DOC search API (blog, 2026-06-30). SIGNALS now
-- downloads each published minute (quadgrams + table of contents) and matches watch terms locally.
--   1. Source row gdelt_v5_ngrams: published static files, no search API. Seeded DISABLED (HS-5);
--      an operator enables it. Titles and links only; article pages are not fetched (operator).
--   2. vault_signals.signal_watch_term: the radar's stored vocabulary (Tier D market infrastructure
--      seeded here; operator terms later). Tiers A (Binder), B (hunts) and C (open theses) are built
--      at run time from those tables and are not stored. Tier E (emerging) is reserved.
-- News stays apart from market data (HS-3). No vault_market. Re-runnable.

BEGIN;

SET search_path TO vault_signals, vault_core, public;

INSERT INTO vault_core.signals_news_source (
  source_key, display_name, tier, access_method, endpoint, auth, verify_before_first_run,
  adapter_enabled, is_active, cadence, latency_notes, category_coverage, seed_evidence_class,
  seed_confidence_ceiling, authority_seed, terms, dedup_keys, why_it_earns_a_slot,
  prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
) VALUES (
  'gdelt_v5_ngrams', 'GDELT 5 Web NGrams (radar)', 'machine', 'published_file_check',
  'https://data.gdeltproject.org/gdeltv5/weblegacy/ngrams/', 'none', false,
  false, false, 'every 10 minutes (files arrive in bursts on a 15-minute heartbeat)',
  'requested at least 5 minutes behind publication, as GDELT asks',
  ARRAY['macro', 'pokemon', 'sports_cards', 'comics', 'collectibles_general']::text[], 'third_party_narrative',
  0.600, 0.700,
  'GDELT open data, published as non-consumptive downloadable files during the GDELT 5 migration. Store metadata, links and matched terms, never article text. Full minute files are kept 7 days, then deleted (operator 2026-10-17); matched rows are kept as immutable snapshots.',
  ARRAY['url_canonical']::text[],
  'One download serves every watch term, so discovery scales with local compute instead of search-API requests.',
  'signals_news_seed', 'inferred', 'signals-news-source@0.1.0', 0.600, 'unverified',
  'Seeded disabled (HS-5). Discovery only: a match is a candidate; the headline classifiers decide whether it is a signal.'
)
ON CONFLICT (source_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS vault_signals.signal_watch_term (
    id                    UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    term                  TEXT NOT NULL CHECK (char_length(term) BETWEEN 2 AND 120),
    term_key              TEXT NOT NULL CHECK (term_key ~ '^[a-z0-9]+( [a-z0-9]+){0,3}$'),
    tier                  TEXT NOT NULL CHECK (tier IN ('D', 'E', 'operator')),
    domain                TEXT NOT NULL CHECK (domain IN ('collectibles', 'sports_cards', 'macro')),
    priority              INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 100),
    context_terms         TEXT[] NOT NULL DEFAULT '{}',
    canonical_entity_ref  TEXT,
    enabled               BOOLEAN NOT NULL DEFAULT true,
    source                TEXT NOT NULL,
    notes                 TEXT,
    CONSTRAINT signal_watch_term_once UNIQUE (term_key, domain)
);

COMMENT ON TABLE vault_signals.signal_watch_term IS
  'Stored GDELT radar vocabulary: Tier D market infrastructure (seeded), Tier E emerging (reserved), operator terms. A single-word term only matches when one of its context_terms (or the domain default) is in the same article. Binder, hunt and thesis terms are derived at run time, not stored. Discovery only: never a price.';

COMMENT ON COLUMN vault_signals.signal_watch_term.term_key IS
  'Lowercase letters and digits, accents folded, 1 to 4 words: the form matched against the quadgram index.';

COMMENT ON COLUMN vault_signals.signal_watch_term.canonical_entity_ref IS
  'Optional text ref (set:…, card:…, pokemon:dex:…). Not a foreign key until the entity layer exists (P7).';

INSERT INTO vault_signals.signal_watch_term (term, term_key, tier, domain, priority, context_terms, source, notes)
SELECT v.term, v.term_key, 'D', v.domain, v.priority, v.context_terms, 'seed:20261017_02', 'Tier D starting list · unverified'
FROM (VALUES
  ('PSA', 'psa', 'collectibles', 70, ARRAY['card','cards','graded','grading','slab','collectible','collectibles','pop report','population report']),
  ('CGC', 'cgc', 'collectibles', 70, ARRAY['comic','comics','card','cards','graded','grading','slab']),
  ('Beckett', 'beckett', 'collectibles', 60, ARRAY['card','cards','graded','grading','bgs']),
  ('SGC', 'sgc', 'collectibles', 55, ARRAY['card','cards','graded','grading']),
  ('TAG Grading', 'tag grading', 'collectibles', 60, ARRAY[]::text[]),
  ('Topps', 'topps', 'collectibles', 70, ARRAY['card','cards','trading','license','licensing','fanatics','rookie']),
  ('Panini', 'panini', 'collectibles', 70, ARRAY['card','cards','trading','license','licensing','fanatics','rookie']),
  ('Fanatics', 'fanatics', 'collectibles', 65, ARRAY['card','cards','trading cards','topps','collect','license','licensing']),
  ('Fanatics Collect', 'fanatics collect', 'collectibles', 70, ARRAY[]::text[]),
  ('Pokemon card', 'pokemon card', 'collectibles', 80, ARRAY[]::text[]),
  ('Pokemon cards', 'pokemon cards', 'collectibles', 80, ARRAY[]::text[]),
  ('Pokemon TCG', 'pokemon tcg', 'collectibles', 85, ARRAY[]::text[]),
  ('Pokemon Trading Card Game', 'pokemon trading card game', 'collectibles', 85, ARRAY[]::text[]),
  ('Pokemon Company', 'pokemon company', 'collectibles', 75, ARRAY[]::text[]),
  ('Pokemon Center', 'pokemon center', 'collectibles', 65, ARRAY[]::text[]),
  ('trading cards', 'trading cards', 'collectibles', 60, ARRAY[]::text[]),
  ('trading card game', 'trading card game', 'collectibles', 60, ARRAY[]::text[]),
  ('Magic: The Gathering', 'magic the gathering', 'collectibles', 60, ARRAY[]::text[]),
  ('Lorcana', 'lorcana', 'collectibles', 55, ARRAY['card','cards','disney','tcg']),
  ('One Piece Card Game', 'one piece card game', 'collectibles', 55, ARRAY[]::text[]),
  ('graded card', 'graded card', 'collectibles', 60, ARRAY[]::text[]),
  ('card grading', 'card grading', 'collectibles', 65, ARRAY[]::text[]),
  ('Heritage Auctions', 'heritage auctions', 'collectibles', 65, ARRAY[]::text[]),
  ('Goldin', 'goldin', 'collectibles', 60, ARRAY['auction','auctions','card','cards','collectibles']),
  ('Whatnot', 'whatnot', 'collectibles', 55, ARRAY['live','auction','card','cards','collectibles','seller','sellers']),
  ('eBay', 'ebay', 'collectibles', 50, ARRAY['trading cards','collectibles','sports cards','pokemon','graded','vault']),
  ('comic book', 'comic book', 'collectibles', 55, ARRAY[]::text[]),
  ('comic books', 'comic books', 'collectibles', 55, ARRAY[]::text[]),
  ('Marvel Comics', 'marvel comics', 'collectibles', 60, ARRAY[]::text[]),
  ('DC Comics', 'dc comics', 'collectibles', 60, ARRAY[]::text[]),
  ('reprint', 'reprint', 'collectibles', 50, ARRAY['card','cards','pokemon','set','comic','booster']),
  ('print run', 'print run', 'collectibles', 55, ARRAY['card','cards','comic','comics','set','booster']),
  ('counterfeit cards', 'counterfeit cards', 'collectibles', 70, ARRAY[]::text[]),
  ('fake cards', 'fake cards', 'collectibles', 60, ARRAY[]::text[]),
  ('sports cards', 'sports cards', 'sports_cards', 70, ARRAY[]::text[]),
  ('rookie card', 'rookie card', 'sports_cards', 70, ARRAY[]::text[]),
  ('sports memorabilia', 'sports memorabilia', 'sports_cards', 60, ARRAY[]::text[]),
  ('card show', 'card show', 'sports_cards', 50, ARRAY[]::text[]),
  ('NFL license', 'nfl license', 'sports_cards', 75, ARRAY[]::text[]),
  ('NBA license', 'nba license', 'sports_cards', 70, ARRAY[]::text[]),
  ('MLB license', 'mlb license', 'sports_cards', 70, ARRAY[]::text[]),
  ('de minimis', 'de minimis', 'macro', 60, ARRAY['tariff','tariffs','customs','imports','shipping']),
  ('tariffs on toys', 'tariffs on toys', 'macro', 60, ARRAY[]::text[]),
  ('postage rates', 'postage rates', 'macro', 55, ARRAY[]::text[]),
  ('USPS', 'usps', 'macro', 50, ARRAY['rates','postage','shipping','price increase']),
  ('1099-K', '1099 k', 'macro', 55, ARRAY[]::text[])
) AS v(term, term_key, domain, priority, context_terms)
ON CONFLICT (term_key, domain) DO NOTHING;

COMMIT;
