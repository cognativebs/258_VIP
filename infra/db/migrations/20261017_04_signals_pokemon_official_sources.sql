-- Official Pokémon sources to corroborate reveals against (operator 2026-10-17: "yes, 2-3").
-- pokemon.com has no feed and press.pokemon.com answers 404, so both come from official YouTube
-- channel feeds, the same route as PSA (no scraping):
--   pokemon_official_youtube  The Official Pokémon YouTube channel (@pokemon), trailers and announcements.
--   pokemon_card_jp_youtube   【公式】ポケモンカードチャンネル (@PokecaCH), linked from pokemon-card.com;
--                             Japanese product reveals, where new cards and sets appear first.
-- Play! Pokémon was checked and left out (tournament streams; competitive never surfaces).
-- Both are first-party disclosure, are seeded DISABLED (HS-5), and only an operator enables them.
-- Each counts as its own independence group, so an official video naming the same set or card
-- joins the Pokémon event and makes a PokéBeach claim "official confirmed". Re-runnable. No vault_market.

BEGIN;

SET search_path TO vault_core, public;

INSERT INTO vault_core.signals_news_source (
  source_key, display_name, tier, access_method, endpoint, auth, verify_before_first_run,
  adapter_enabled, is_active, cadence, latency_notes, category_coverage, seed_evidence_class,
  seed_confidence_ceiling, authority_seed, terms, dedup_keys, why_it_earns_a_slot,
  prov_source, prov_method, prov_rule_version, prov_confidence, prov_verification, prov_notes
) VALUES
  ('pokemon_official_youtube', 'The Official Pokémon YouTube channel', 'machine', 'rss',
   'https://www.youtube.com/feeds/videos.xml?channel_id=UCFctpiB_Hnlk3ejWfHqSm6Q', 'none', false,
   false, false, 'hourly', 'minutes after upload', ARRAY['pokemon']::text[], 'primary_disclosure',
   0.950, 0.950,
   'Official channel feed. Store titles, links and dates only; never video content.',
   ARRAY['url_canonical']::text[],
   'First-party announcements: confirms what trade press reports.',
   'signals_news_seed', 'inferred', 'signals-news-source@0.1.0', 0.750, 'unverified',
   'Seeded disabled (HS-5). Channel id verified 2026-10-17 from youtube.com/@pokemon.'),
  ('pokemon_card_jp_youtube', '【公式】ポケモンカードチャンネル (Pokémon Card Game, Japan)', 'machine', 'rss',
   'https://www.youtube.com/feeds/videos.xml?channel_id=UCysOBNRW0rEmLtFptj1TN7A', 'none', false,
   false, false, 'hourly', 'minutes after upload', ARRAY['pokemon']::text[], 'primary_disclosure',
   0.950, 0.950,
   'Official channel feed. Store titles, links and dates only; never video content.',
   ARRAY['url_canonical']::text[],
   'Japanese TCG reveals come first; first-party confirmation of new products and cards.',
   'signals_news_seed', 'inferred', 'signals-news-source@0.1.0', 0.750, 'unverified',
   'Seeded disabled (HS-5). Channel id verified 2026-10-17: pokemon-card.com links youtube.com/channel/UCysOBNRW0rEmLtFptj1TN7A.')
ON CONFLICT (source_key) DO NOTHING;

COMMIT;
