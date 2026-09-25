-- SIGNALS v1 spine P2 — event layer and source lineage.
-- Corroboration counts distinct PRIMARY independence groups.
-- Derivatives and discussion are stored. They do not add a source.
-- No priced_unit. No vault_market writes.

BEGIN;

SET search_path TO vault_signals, vault_core, vault_evidence, public;

CREATE SCHEMA IF NOT EXISTS vault_signals;

CREATE TABLE IF NOT EXISTS vault_signals.event (
    id                            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    event_key                     TEXT NOT NULL UNIQUE,
    title                         TEXT NOT NULL,
    occurred_at                   TIMESTAMPTZ,
    first_seen_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type                    TEXT NOT NULL,
    primary_origin_document_id    UUID REFERENCES vault_signals.raw_document (id) ON DELETE RESTRICT,
    status                        TEXT NOT NULL DEFAULT 'open',
    prov_source                   TEXT NOT NULL,
    prov_method                   vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version             TEXT NOT NULL,
    prov_confidence               NUMERIC(4,3) NOT NULL
                                  CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification             vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes                    TEXT
);

COMMENT ON TABLE vault_signals.event IS
  'A real-world occurrence. Several documents can describe one event. Grouping is inferred · unverified until a person confirms it.';

CREATE TABLE IF NOT EXISTS vault_signals.event_evidence (
    id                    UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    event_id              UUID NOT NULL REFERENCES vault_signals.event (id) ON DELETE RESTRICT,
    raw_document_id       UUID NOT NULL REFERENCES vault_signals.raw_document (id) ON DELETE RESTRICT,
    role                  TEXT NOT NULL
                          CHECK (role IN ('PRIMARY', 'DERIVATIVE', 'DISCUSSION', 'UNKNOWN')),
    independence_group    TEXT,
    detected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT event_evidence_document_once UNIQUE (event_id, raw_document_id),
    CONSTRAINT event_evidence_primary_has_group CHECK (
      role <> 'PRIMARY' OR independence_group IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS event_evidence_event_idx
  ON vault_signals.event_evidence (event_id);

CREATE INDEX IF NOT EXISTS event_evidence_document_idx
  ON vault_signals.event_evidence (raw_document_id);

COMMENT ON TABLE vault_signals.event_evidence IS
  'Document membership in an event. independent_source_count is the number of distinct independence_group values on PRIMARY rows. DERIVATIVE and DISCUSSION rows are stored for attention and do not corroborate.';

CREATE TABLE IF NOT EXISTS vault_signals.origin_link (
    id                  UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    from_document_id    UUID NOT NULL REFERENCES vault_signals.raw_document (id) ON DELETE RESTRICT,
    to_document_id      UUID NOT NULL REFERENCES vault_signals.raw_document (id) ON DELETE RESTRICT,
    relation            TEXT NOT NULL
                        CHECK (relation IN ('QUOTES', 'SYNDICATES', 'LINKS_TO', 'REWRITES')),
    detected_by         TEXT NOT NULL,
    confidence          NUMERIC(4,3) NOT NULL
                        CHECK (confidence >= 0 AND confidence <= 1),
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    prov_rule_version   TEXT NOT NULL,
    prov_verification   vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    CONSTRAINT origin_link_not_self CHECK (from_document_id <> to_document_id),
    CONSTRAINT origin_link_once UNIQUE (from_document_id, to_document_id, relation)
);

CREATE INDEX IF NOT EXISTS origin_link_from_idx
  ON vault_signals.origin_link (from_document_id);

CREATE INDEX IF NOT EXISTS origin_link_to_idx
  ON vault_signals.origin_link (to_document_id);

COMMENT ON TABLE vault_signals.origin_link IS
  'Directed lineage between documents. confidence is inferred · unverified unless prov_verification says otherwise. This is not a signal score.';

CREATE OR REPLACE FUNCTION vault_signals.independent_source_count(p_event_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    COUNT(DISTINCT independence_group) FILTER (WHERE role = 'PRIMARY'),
    0
  )::integer
    FROM vault_signals.event_evidence
   WHERE event_id = p_event_id;
$$;

COMMENT ON FUNCTION vault_signals.independent_source_count(uuid) IS
  'Corroboration. Counts distinct PRIMARY independence groups. Five derivatives of one release count as 1. Two independent reports plus derivatives count as 2.';

COMMIT;
