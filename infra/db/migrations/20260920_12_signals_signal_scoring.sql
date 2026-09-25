-- SIGNALS v1 spine P3 — signal object and exactly three stored scores.
-- priority_score is GENERATED. It is not an independently authored number.
-- Half-lives and weight coefficients are unverified estimates.
-- Section 5 coefficients were not in the repo; they are withheld (see ADR 0013).
-- Attention is a separate table and is not an input to priority_score.
-- No priced_unit. No vault_market writes.

BEGIN;

SET search_path TO vault_signals, vault_core, vault_evidence, public;

CREATE SCHEMA IF NOT EXISTS vault_signals;

CREATE TABLE IF NOT EXISTS vault_signals.signal_type (
    id                        UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    code                      TEXT NOT NULL UNIQUE,
    display_name              TEXT NOT NULL,
    default_half_life_hours   INTEGER NOT NULL CHECK (default_half_life_hours > 0),
    description               TEXT NOT NULL,
    half_life_verified        BOOLEAN NOT NULL DEFAULT false
);

COMMENT ON TABLE vault_signals.signal_type IS
  'Per-type decay configuration. default_half_life_hours is a starting guess in a data table. half_life_verified stays false until a measurement replaces the guess.';

COMMENT ON COLUMN vault_signals.signal_type.half_life_verified IS
  'false means the half-life is a typed estimate, not a measurement. Seed rows stay false.';

CREATE TABLE IF NOT EXISTS vault_signals.score_weight_set (
    id            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    name          TEXT NOT NULL,
    version       TEXT NOT NULL,
    weights_json  JSONB NOT NULL,
    verified      BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT score_weight_set_version_unique UNIQUE (name, version)
);

COMMENT ON TABLE vault_signals.score_weight_set IS
  'Versioned scoring weights. verified defaults false. Application code must not hardcode a weight. The seeded row withholds Section 5 coefficients because that note was not in the repository.';

-- Structural stand-in so priority_score can be a generated column.
-- A generated column cannot read score_weight_set (the expression must be immutable).
-- This product is not the architecture note's Section 5 formula. Coefficients withheld.
CREATE OR REPLACE FUNCTION vault_signals.priority_from_scores(
  p_confidence numeric,
  p_impact numeric,
  p_noise numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT round(p_confidence * p_impact * (1 - p_noise), 6);
$$;

COMMENT ON FUNCTION vault_signals.priority_from_scores(numeric, numeric, numeric) IS
  'Structural stand-in for priority_score: base_confidence * base_impact * (1 - noise_probability). Not Section 5. No coefficients. score_weight_set.verified is false.';

CREATE TABLE IF NOT EXISTS vault_signals.signal (
    id                    UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    signal_type_id        UUID NOT NULL REFERENCES vault_signals.signal_type (id) ON DELETE RESTRICT,
    domain                TEXT NOT NULL,
    title                 TEXT NOT NULL,
    summary               TEXT NOT NULL,
    direction             TEXT NOT NULL,
    first_seen_at         TIMESTAMPTZ NOT NULL,
    last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_id              UUID NOT NULL REFERENCES vault_signals.event (id) ON DELETE RESTRICT,
    base_confidence       NUMERIC(4,3) NOT NULL
                          CHECK (base_confidence >= 0 AND base_confidence <= 1),
    base_impact           NUMERIC(4,3) NOT NULL
                          CHECK (base_impact >= 0 AND base_impact <= 1),
    noise_probability     NUMERIC(4,3) NOT NULL
                          CHECK (noise_probability >= 0 AND noise_probability <= 1),
    priority_score        NUMERIC(12,6) GENERATED ALWAYS AS (
                            vault_signals.priority_from_scores(
                              base_confidence, base_impact, noise_probability
                            )
                          ) STORED,
    score_weight_set_id   UUID NOT NULL REFERENCES vault_signals.score_weight_set (id) ON DELETE RESTRICT,
    created_by_version    TEXT NOT NULL,
    prov_source           TEXT NOT NULL,
    prov_method           vault_evidence.provenance_method NOT NULL DEFAULT 'inferred',
    prov_rule_version     TEXT NOT NULL,
    prov_confidence       NUMERIC(4,3) NOT NULL
                          CHECK (prov_confidence >= 0 AND prov_confidence <= 1),
    prov_verification     vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    prov_notes            TEXT
);

CREATE INDEX IF NOT EXISTS signal_event_idx
  ON vault_signals.signal (event_id);

CREATE INDEX IF NOT EXISTS signal_type_idx
  ON vault_signals.signal (signal_type_id, first_seen_at DESC);

COMMENT ON TABLE vault_signals.signal IS
  'Exactly three stored scores: base_confidence, base_impact, noise_probability. priority_score is generated from those three. relevance, novelty, magnitude, actionability, and source_quality are deliberately absent. Attention is not a column here.';

COMMENT ON COLUMN vault_signals.signal.priority_score IS
  'Generated. Not stored independently. Structural product pending Section 5 coefficients (ADR 0013, HS-6).';

CREATE TABLE IF NOT EXISTS vault_signals.signal_entity (
    id            UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    signal_id     UUID NOT NULL REFERENCES vault_signals.signal (id) ON DELETE RESTRICT,
    entity_ref    TEXT NOT NULL,
    entity_kind   TEXT NOT NULL,
    relevance     NUMERIC(4,3)
                  CHECK (relevance IS NULL OR (relevance >= 0 AND relevance <= 1)),
    CONSTRAINT signal_entity_once UNIQUE (signal_id, entity_ref, entity_kind)
);

COMMENT ON TABLE vault_signals.signal_entity IS
  'Placeholder link. entity_ref is TEXT until the entity layer exists. relevance here is membership strength, not a fourth signal score, and not a priced_unit join.';

COMMENT ON COLUMN vault_signals.signal_entity.entity_ref IS
  'TEXT placeholder. Not a foreign key. Not priced_unit_id. Not a UnitRef.';

CREATE TABLE IF NOT EXISTS vault_signals.attention_observation (
    id               UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    signal_id        UUID REFERENCES vault_signals.signal (id) ON DELETE RESTRICT,
    entity_ref       TEXT,
    observed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_id        TEXT NOT NULL REFERENCES vault_core.signals_news_source (source_key),
    mention_volume   INTEGER NOT NULL CHECK (mention_volume >= 0),
    volume_delta     NUMERIC NOT NULL,
    window_hours     INTEGER NOT NULL CHECK (window_hours > 0),
    prov_method      vault_evidence.provenance_method NOT NULL DEFAULT 'observed',
    prov_rule_version TEXT NOT NULL,
    prov_verification vault_evidence.verification_status NOT NULL DEFAULT 'unverified',
    CONSTRAINT attention_has_subject CHECK (signal_id IS NOT NULL OR entity_ref IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS attention_signal_observed_idx
  ON vault_signals.attention_observation (signal_id, observed_at DESC);

COMMENT ON TABLE vault_signals.attention_observation IS
  'Mention volume over a window. Separate from confidence by design. A claim can be low-confidence and high-attention. This table is not an input to priority_score or signal_influence.';

INSERT INTO vault_signals.signal_type
  (code, display_name, default_half_life_hours, description, half_life_verified)
VALUES
  ('PLAYER_INJURY', 'Player injury', 48,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('RESTOCK', 'Restock', 336,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('AUCTION_RESULT', 'Auction result', 720,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('SET_RELEASE', 'Set release', 2880,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('REPRINT', 'Reprint', 2160,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('LICENSE_CHANGE', 'License change', 8760,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('HOF_ANNOUNCEMENT', 'Hall of fame announcement', 4320,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('MACRO_TREND', 'Macro trend', 4320,
   'Starting guess · unverified. Not a measured half-life.', false),
  ('SUPPLY_CHANGE', 'Supply change', 720,
   'Starting guess · unverified. Not a measured half-life.', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO vault_signals.score_weight_set (name, version, weights_json, verified)
VALUES (
  'spine-structural-stand-in',
  '0.0.0',
  jsonb_build_object(
    'status', 'coefficients_withheld',
    'reason', 'Architecture note Section 5 was not in the repository at build time. No coefficients were invented.',
    'stored_inputs', jsonb_build_array('base_confidence', 'base_impact', 'noise_probability'),
    'excluded_inputs', jsonb_build_array(
      'relevance', 'novelty', 'magnitude', 'actionability', 'source_quality', 'attention'
    ),
    'generated_expression', 'base_confidence * base_impact * (1 - noise_probability)',
    'generated_expression_status', 'structural stand-in so priority_score can be GENERATED. Not Section 5. verified=false.'
  ),
  false
)
ON CONFLICT (name, version) DO NOTHING;

COMMIT;
