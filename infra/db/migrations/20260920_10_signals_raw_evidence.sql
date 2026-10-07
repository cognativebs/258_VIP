-- SIGNALS v1 spine P1 — raw evidence vault.
-- Depends on vault_core.signals_news_source (20260920_06). Does not move it.
-- No article bodies. No recipient addresses. No pgvector column (G-1).
-- No writes to vault_market.

BEGIN;

SET search_path TO vault_signals, vault_core, public;

CREATE SCHEMA IF NOT EXISTS vault_signals;

COMMENT ON SCHEMA vault_signals IS
  'SIGNALS evidence spine (ADR 0013). News pipeline only. Not vault_market. vault_core.signals_news_source stays put (G-4).';

CREATE TABLE IF NOT EXISTS vault_signals.ingest_run (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    source_id           TEXT NOT NULL REFERENCES vault_core.signals_news_source (source_key),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'running',
    documents_fetched   INTEGER NOT NULL DEFAULT 0 CHECK (documents_fetched >= 0),
    documents_new       INTEGER NOT NULL DEFAULT 0 CHECK (documents_new >= 0),
    error_text          TEXT
);

COMMENT ON TABLE vault_signals.ingest_run IS
  'One fetch attempt against a news source. Every raw_document belongs to a run. Adapters stay disabled; this table does not enable them.';

CREATE TABLE IF NOT EXISTS vault_signals.raw_document (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    source_id           TEXT NOT NULL REFERENCES vault_core.signals_news_source (source_key),
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_url          TEXT,
    url_canonical       TEXT,
    content_hash        TEXT NOT NULL,
    http_status         INTEGER,
    raw_payload_ref     TEXT NOT NULL CHECK (octet_length(raw_payload_ref) BETWEEN 1 AND 1024),
    extraction_status   TEXT NOT NULL DEFAULT 'pending',
    ingest_run_id       UUID NOT NULL REFERENCES vault_signals.ingest_run (id) ON DELETE RESTRICT,
    CONSTRAINT raw_document_source_hash_unique UNIQUE (source_id, content_hash)
);

CREATE INDEX IF NOT EXISTS raw_document_ingest_run_idx
  ON vault_signals.raw_document (ingest_run_id);

CREATE INDEX IF NOT EXISTS raw_document_url_canonical_idx
  ON vault_signals.raw_document (url_canonical);

COMMENT ON TABLE vault_signals.raw_document IS
  'One row per fetched artifact. raw_payload_ref is an object-storage key, not the article body. url_canonical has tracking parameters and recipient addresses removed.';

COMMENT ON COLUMN vault_signals.raw_document.id IS
  'Embedding seam (G-1): a future embedding table attaches at raw_document.id. No pgvector column and no embedding table in this migration.';

COMMENT ON COLUMN vault_signals.raw_document.raw_payload_ref IS
  'Object-storage key. Do not store article bodies in Postgres.';

CREATE TABLE IF NOT EXISTS vault_signals.document_snapshot (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    raw_document_id     UUID NOT NULL REFERENCES vault_signals.raw_document (id) ON DELETE RESTRICT,
    stored_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    storage_backend     TEXT NOT NULL,
    storage_key         TEXT NOT NULL CHECK (octet_length(storage_key) BETWEEN 1 AND 1024),
    byte_size           BIGINT NOT NULL CHECK (byte_size >= 0),
    media_type          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS document_snapshot_document_idx
  ON vault_signals.document_snapshot (raw_document_id);

COMMENT ON TABLE vault_signals.document_snapshot IS
  'Immutable byte-level record of a fetched artifact. UPDATE and DELETE are rejected. The bytes live in object storage; this row is the pointer.';

-- Canonical URL: drop newsletter tracking params and any recipient address.
-- Keep this list aligned with packages/signals/src/spine.ts.
CREATE OR REPLACE FUNCTION vault_signals.normalize_signal_url(p_url text, p_mode text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
  base text;
  query text;
  pair text;
  key text;
  val text;
  raw_kept text[] := ARRAY[]::text[];
  sorted_kept text[];
  tracking text[] := ARRAY[
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
    'utm_name','utm_reader','utm_viz_id','utm_pubreferrer',
    'mc_cid','mc_eid','fbclid','gclid','gclsrc','dclid','igshid','igsh',
    '_hsenc','_hsmi','mkt_tok','ml_subscriber','ml_subscriber_hash',
    'email','recipient','subscriber','subscriber_id','subscriberid',
    'e','uid','user_id','user','ref','source_email'
  ];
  recipient text[] := ARRAY[
    'email','recipient','subscriber','subscriber_id','subscriberid',
    'e','uid','user_id','user','source_email','ml_subscriber','ml_subscriber_hash'
  ];
  email_re text := '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}';
BEGIN
  IF p_url IS NULL OR btrim(p_url) = '' THEN
    RETURN NULL;
  END IF;
  IF p_mode NOT IN ('canonical', 'redact') THEN
    RAISE EXCEPTION 'normalize_signal_url mode must be canonical or redact';
  END IF;

  v := regexp_replace(btrim(p_url), '#.*$', '');
  v := regexp_replace(v, '^(https?://)[^/@[:space:]]+@', '\1', 'i');

  IF position('?' IN v) > 0 THEN
    base := split_part(v, '?', 1);
    query := substring(v FROM position('?' IN v) + 1);
  ELSE
    base := v;
    query := NULL;
  END IF;

  IF query IS NOT NULL AND query <> '' THEN
    FOREACH pair IN ARRAY string_to_array(query, '&') LOOP
      IF pair IS NULL OR pair = '' THEN
        CONTINUE;
      END IF;
      key := split_part(pair, '=', 1);
      val := CASE
        WHEN position('=' IN pair) = 0 THEN ''
        ELSE substring(pair FROM position('=' IN pair) + 1)
      END;
      IF p_mode = 'canonical' AND lower(key) = ANY (tracking) THEN
        CONTINUE;
      END IF;
      IF p_mode = 'redact' AND lower(key) = ANY (recipient) THEN
        CONTINUE;
      END IF;
      IF val ~* email_re THEN
        CONTINUE;
      END IF;
      raw_kept := array_append(raw_kept, key || '=' || val);
    END LOOP;
    SELECT array_agg(item ORDER BY item) INTO sorted_kept FROM unnest(raw_kept) AS item;
  END IF;

  IF sorted_kept IS NOT NULL AND cardinality(sorted_kept) > 0 THEN
    v := base || '?' || array_to_string(sorted_kept, '&');
  ELSE
    v := base;
  END IF;

  IF v ~* email_re THEN
    RAISE EXCEPTION 'recipient email must not be stored in a signals URL'
      USING ERRCODE = '23514';
  END IF;
  RETURN v;
END;
$$;

COMMENT ON FUNCTION vault_signals.normalize_signal_url(text, text) IS
  'canonical strips tracking params and recipient addresses. redact strips recipient addresses and leaves other query params. Neither mode persists an email address.';

CREATE OR REPLACE FUNCTION vault_signals.raw_document_normalize_urls()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  email_re text := '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}';
BEGIN
  NEW.source_url := vault_signals.normalize_signal_url(NEW.source_url, 'redact');
  NEW.url_canonical := vault_signals.normalize_signal_url(
    COALESCE(NEW.url_canonical, NEW.source_url),
    'canonical'
  );
  IF NEW.raw_payload_ref ~* email_re THEN
    RAISE EXCEPTION 'recipient email must not be stored in raw_payload_ref'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_raw_document_normalize_urls ON vault_signals.raw_document;
CREATE TRIGGER trg_raw_document_normalize_urls
  BEFORE INSERT OR UPDATE OF source_url, url_canonical, raw_payload_ref
  ON vault_signals.raw_document
  FOR EACH ROW
  EXECUTE FUNCTION vault_signals.raw_document_normalize_urls();

CREATE OR REPLACE FUNCTION vault_signals.forbid_document_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'document_snapshot rows are immutable: % is forbidden', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_document_snapshot_no_update ON vault_signals.document_snapshot;
CREATE TRIGGER trg_document_snapshot_no_update
  BEFORE UPDATE ON vault_signals.document_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION vault_signals.forbid_document_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_document_snapshot_no_delete ON vault_signals.document_snapshot;
CREATE TRIGGER trg_document_snapshot_no_delete
  BEFORE DELETE ON vault_signals.document_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION vault_signals.forbid_document_snapshot_mutation();

COMMIT;
