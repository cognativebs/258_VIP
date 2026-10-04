-- PokéBeach hybrid connector, steps 1-3 (2026-10-03, Greg's build spec; decisions recorded the same day).
-- 1. signals_news_source.access_method widens to allow 'html_page' (operator-approved): the CHECK is
--    dropped and re-added as a superset, so no existing row can fail it.
-- 2. Generic item identity, not PokéBeach-specific (the spec: "an adapter, not a parallel subsystem"):
--    vault_signals.source_item (one row per canonical URL per source; first/last seen, revision count),
--    vault_signals.source_item_revision (history; a material change is the SOURCE_REVISION record),
--    vault_signals.source_fetch_state (conditional GET, backoff, parser health per fetched URL).
-- 3. vault_core.signals_source_author: tracked authors with per-specialty weights (configuration, not code).
-- 4. Source rows, all disabled (HS-5): pokebeach_official (homepage, canonical), pokebeach_frontpage_feed
--    (community front-page feed, discovery only), pokebeach_members (public member activity; gated on an
--    access check because forum pages answered 403 to an automated fetch). pokebeach_rss is re-described
--    as the forum RSS, a discovery feed that links articles to their comment threads.
-- 5. daily-collectibles@0.2.0: the Pokémon lane reads pokebeach_official.
-- No scoring columns (ADR 0013: three stored scores, read-time priority). Re-runnable. No vault_market.

BEGIN;

SET search_path TO vault_signals, vault_core, public;

ALTER TABLE vault_core.signals_news_source DROP CONSTRAINT IF EXISTS signals_news_source_access_method_check;
ALTER TABLE vault_core.signals_news_source
  ADD CONSTRAINT signals_news_source_access_method_check CHECK (
    access_method IN ('rest_api', 'rss', 'rss_or_scrape_check', 'published_file_check', 'gmail_label_poll', 'html_page')
  );

CREATE TABLE IF NOT EXISTS vault_signals.source_item (
    id                    UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    source_id             TEXT NOT NULL REFERENCES vault_core.signals_news_source (source_key) ON DELETE RESTRICT,
    item_kind             TEXT NOT NULL CHECK (item_kind IN ('article', 'thread', 'forum_post', 'member_activity')),
    external_id           TEXT,
    canonical_url         TEXT NOT NULL CHECK (canonical_url ~ '^https://'),
    title                 TEXT NOT NULL,
    author_name           TEXT,
    author_ref            TEXT,
    published_at          TIMESTAMPTZ,
    published_at_source   TEXT,
    modified_at           TIMESTAMPTZ,
    excerpt               TEXT CHECK (excerpt IS NULL OR char_length(excerpt) <= 600),
    content_hash          TEXT CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
    status                TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'confirmed')),
    first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    revision_count        INTEGER NOT NULL DEFAULT 0 CHECK (revision_count >= 0),
    discovered_via        TEXT[] NOT NULL DEFAULT '{}',
    discussion_url        TEXT,
    parser_version        TEXT NOT NULL,
    prov_method           vault_evidence.provenance_method NOT NULL DEFAULT 'observed',
    prov_verification     vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    CONSTRAINT source_item_url_once UNIQUE (source_id, canonical_url),
    CONSTRAINT source_item_confirmed_has_time CHECK (
      status <> 'confirmed' OR (published_at IS NOT NULL AND published_at_source IS NOT NULL AND content_hash IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS source_item_external_once
  ON vault_signals.source_item (source_id, item_kind, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_item_published_idx
  ON vault_signals.source_item (source_id, published_at DESC);

COMMENT ON TABLE vault_signals.source_item IS
  'One row per item a source published, keyed by canonical URL (and the source''s own id when it has one). Discovery routes, comment counts and feed timestamps never create a new row. published_at is set only from an authoritative timestamp (published_at_source names it); until then status is discovered. Bodies are not stored here; raw pages stay in immutable snapshots.';

CREATE TABLE IF NOT EXISTS vault_signals.source_item_revision (
    id               UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    source_item_id   UUID NOT NULL REFERENCES vault_signals.source_item (id) ON DELETE RESTRICT,
    observed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_document_id  UUID REFERENCES vault_signals.raw_document (id) ON DELETE RESTRICT,
    content_hash     TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    title            TEXT NOT NULL,
    author_name      TEXT,
    published_at     TIMESTAMPTZ,
    excerpt          TEXT CHECK (excerpt IS NULL OR char_length(excerpt) <= 600),
    change_kind      TEXT NOT NULL CHECK (change_kind IN ('initial', 'material'))
);

CREATE INDEX IF NOT EXISTS source_item_revision_item_idx
  ON vault_signals.source_item_revision (source_item_id, observed_at);

COMMENT ON TABLE vault_signals.source_item_revision IS
  'Append-only history of an item''s material content (title, author, publish time, publisher summary). change_kind material is the SOURCE_REVISION record. Nothing is overwritten silently.';

CREATE TABLE IF NOT EXISTS vault_signals.source_fetch_state (
    source_id              TEXT NOT NULL REFERENCES vault_core.signals_news_source (source_key) ON DELETE RESTRICT,
    url                    TEXT NOT NULL,
    etag                   TEXT,
    last_modified          TEXT,
    last_status            INTEGER,
    last_fetched_at        TIMESTAMPTZ,
    last_success_at        TIMESTAMPTZ,
    consecutive_failures   INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    next_attempt_at        TIMESTAMPTZ,
    parser_state           TEXT NOT NULL DEFAULT 'ok' CHECK (parser_state IN ('ok', 'degraded')),
    parser_note            TEXT,
    PRIMARY KEY (source_id, url)
);

COMMENT ON TABLE vault_signals.source_fetch_state IS
  'Per-URL fetch bookkeeping: conditional GET validators, exponential backoff, and parser health (degraded = the markup no longer parses; nothing was ingested). Feeds the Sources diagnostics.';

CREATE TABLE IF NOT EXISTS vault_core.signals_source_author (
    id                 UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    source_key         TEXT NOT NULL REFERENCES vault_core.signals_news_source (source_key) ON DELETE RESTRICT,
    handle             TEXT NOT NULL,
    profile_url        TEXT CHECK (profile_url IS NULL OR profile_url ~ '^https://'),
    tracked            BOOLEAN NOT NULL DEFAULT true,
    weights            JSONB NOT NULL,
    weights_from       TEXT NOT NULL CHECK (weights_from IN ('operator', 'default', 'calibrated')),
    weights_verified   BOOLEAN NOT NULL DEFAULT false,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signals_source_author_once UNIQUE (source_key, handle),
    CONSTRAINT signals_source_author_weights_shape CHECK (
      jsonb_typeof(weights) = 'object'
      AND weights ?& ARRAY['news', 'sealed', 'collecting', 'competitive', 'market']
      AND (weights->>'news')::numeric BETWEEN 0 AND 1
      AND (weights->>'sealed')::numeric BETWEEN 0 AND 1
      AND (weights->>'collecting')::numeric BETWEEN 0 AND 1
      AND (weights->>'competitive')::numeric BETWEEN 0 AND 1
      AND (weights->>'market')::numeric BETWEEN 0 AND 1
    )
);

COMMENT ON TABLE vault_core.signals_source_author IS
  'Tracked authors per source with per-specialty weights (news, sealed, collecting, competitive, market). Configuration the operator edits; never one credibility number, never displayed as a judgment of the person. Only public activity is ever read.';

INSERT INTO vault_core.signals_news_source (
  source_key, display_name, tier, access_method, endpoint, auth, verify_before_first_run, adapter_enabled, is_active,
  blocked_reason, cadence, category_coverage, seed_evidence_class, seed_confidence_ceiling, authority_seed,
  redistribution_allowed, may_raise_valuation_ceiling, terms, dedup_keys, iqvault_only, why_it_earns_a_slot,
  prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
) VALUES
  ('pokebeach_official', 'PokéBeach (official news)', 'machine', 'html_page', 'https://www.pokebeach.com/', 'none', true, false, false,
   'robots.txt allows crawling (checked 2026-10-03); the site terms page refused an automated fetch, so the operator confirms terms before enabling',
   'every 30 minutes', ARRAY['pokemon']::text[], 'trade_press', 0.900, 0.850,
   false, false,
   'Front page and article pages only, read politely (descriptive User-Agent, throttled, conditional GET). Store title, author, link, UTC publish time and the publisher''s meta description; article bodies stay in local raw snapshots only. Never logged in.',
   ARRAY['canonical_url','wp_post_id']::text[], true,
   'Canonical PokéBeach news: set and product reveals, release dates, pull rates, distribution. Confirmed announcements score high; PokéBeach''s own interpretation and rumours score lower (classifier, later step).',
   'signals_news_seed', 'inferred', 'signals-news-source@0.3.0', 0.900, 'unverified',
   'Added 2026-10-03 (PokéBeach connector). Confidence ceiling 0.90 is the operator''s spec value · unverified. Adapter off.'),
  ('pokebeach_frontpage_feed', 'PokéBeach front-page feed (community)', 'machine', 'rss', 'https://kaprestridge.github.io/pokebeach-news-feed/feed.xml', 'none', true, false, false,
   NULL, 'every 30 minutes', ARRAY['pokemon']::text[], 'discovery_only', 0.100, 0.300,
   false, false,
   'Third-party, community-maintained. Discovery only: its article URLs are fetched from PokéBeach itself; its timestamps (Pacific time labeled GMT) are never used.',
   ARRAY['canonical_url']::text[], true,
   'Catches front-page articles the homepage poll missed.',
   'signals_news_seed', 'inferred', 'signals-news-source@0.3.0', 0.100, 'unverified',
   'Added 2026-10-03. Never produces a signal on its own. Adapter off.'),
  ('pokebeach_members', 'PokéBeach tracked members (public activity)', 'machine', 'html_page', NULL, 'none', true, false, false,
   'member pages answered 403 to an automated fetch (2026-10-03); run the access check before enabling, and never bypass a block or log in',
   'every 3 hours', ARRAY['pokemon']::text[], 'community_opinion', 0.350, 0.400,
   false, false,
   'Public activity of configured members only; no login, no private feed, no crawling of the wider forum. Store handle, thread, link, time and a short excerpt.',
   ARRAY['canonical_url','post_id']::text[], true,
   'Community sentiment (sealed, chase cards, scarcity chatter). Opinion: low factual confidence; meaningful only when independent members agree.',
   'signals_news_seed', 'inferred', 'signals-news-source@0.3.0', 0.350, 'unverified',
   'Added 2026-10-03. Adapter not built until the access check passes.')
ON CONFLICT (source_key) DO NOTHING;

UPDATE vault_core.signals_news_source
   SET display_name = 'PokéBeach forum RSS (discovery)',
       terms = 'PokéBeach forum RSS (https://www.pokebeach.com/forums/forum/-/index.rss). Discovery only: links articles to their comment threads. Its dates are last-reply times and are never used as publish times.',
       why_it_earns_a_slot = 'Links each article to its forum discussion thread; never creates an article and never fills a lane.',
       prov_notes = 'Re-described 2026-10-03 as a discovery feed (PokéBeach connector). Adapter off.'
 WHERE source_key = 'pokebeach_rss' AND NOT adapter_enabled AND display_name = 'PokeBeach';

INSERT INTO vault_core.signals_source_author (source_key, handle, profile_url, tracked, weights, weights_from)
VALUES
  ('pokebeach_members', 'Water Pokémon Master', NULL, true, '{"news":1,"sealed":0.7,"collecting":0.8,"competitive":0.8,"market":0.8}'::jsonb, 'operator'),
  ('pokebeach_members', 'The-Kaiser', NULL, true, '{"news":0.4,"sealed":1,"collecting":0.9,"competitive":0.3,"market":0.8}'::jsonb, 'operator'),
  ('pokebeach_members', 'oklandon', NULL, true, '{"news":0.5,"sealed":0.5,"collecting":0.5,"competitive":0.5,"market":0.5}'::jsonb, 'default'),
  ('pokebeach_members', 'PMJ', NULL, true, '{"news":0.5,"sealed":0.5,"collecting":0.5,"competitive":0.5,"market":0.5}'::jsonb, 'default'),
  ('pokebeach_members', 'Travinking0927', NULL, true, '{"news":0.5,"sealed":0.5,"collecting":0.5,"competitive":0.5,"market":0.5}'::jsonb, 'default'),
  ('pokebeach_members', 'ztnoob', NULL, true, '{"news":0.5,"sealed":0.5,"collecting":0.5,"competitive":0.5,"market":0.5}'::jsonb, 'default'),
  ('pokebeach_members', 'NovaAcerola', NULL, true, '{"news":0.5,"sealed":0.5,"collecting":0.5,"competitive":0.5,"market":0.5}'::jsonb, 'default'),
  ('pokebeach_members', 'Hollow Foil', NULL, true, '{"news":0.5,"sealed":0.5,"collecting":0.5,"competitive":0.5,"market":0.5}'::jsonb, 'default')
ON CONFLICT (source_key, handle) DO NOTHING;

INSERT INTO vault_core.signals_curation_profile (name, version, domain, profile_json, verified, is_current)
VALUES ('daily-collectibles', '0.2.0', 'collectibles', $profile${
  "schema": "vip_signals_curation_v1",
  "name": "daily-collectibles",
  "version": "0.2.0",
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
        "pokebeach_official"
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
  "notes": "0.2.0 (2026-10-03): Pokémon lane = official PokéBeach news (homepage connector); the forum RSS is discovery only. Shares unchanged from 0.1.0 · unverified."
}$profile$::jsonb, false, false)
ON CONFLICT (name, version) DO NOTHING;

UPDATE vault_core.signals_curation_profile
   SET is_current = false
 WHERE name = 'daily-collectibles' AND version = '0.1.0' AND is_current;

UPDATE vault_core.signals_curation_profile
   SET is_current = true
 WHERE name = 'daily-collectibles' AND version = '0.2.0'
   AND NOT EXISTS (SELECT 1 FROM vault_core.signals_curation_profile WHERE name = 'daily-collectibles' AND is_current);

COMMIT;
