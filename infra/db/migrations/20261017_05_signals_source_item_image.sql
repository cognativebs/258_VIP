-- Featured image for source items (operator 2026-10-17). The image URL a feed publishes for an
-- article (the PokéBeach community feed's media:thumbnail), shown on the Signal Desk. Display only:
-- not part of the content hash, so it never creates a revision. https only. The image itself is
-- never downloaded or stored. Re-runnable. No vault_market.

BEGIN;

SET search_path TO vault_signals, public;

ALTER TABLE vault_signals.source_item ADD COLUMN IF NOT EXISTS image_url TEXT;

DO $$
BEGIN
  ALTER TABLE vault_signals.source_item
    ADD CONSTRAINT source_item_image_url_check CHECK (image_url IS NULL OR (image_url ~ '^https://' AND char_length(image_url) <= 2048));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN vault_signals.source_item.image_url IS
  'Featured image URL as the feed published it (display only, not downloaded, not in the content hash).';

COMMIT;
