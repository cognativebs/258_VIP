-- SIGNALS v1 spine P4 — read-time decay and the valuation firewall.
-- Decay is computed when read. No current-value column is stored.
-- Half-life comes from signal_type, not from a code constant.
-- The firewall reads may_raise_valuation_ceiling and rejects the join.
-- No writes to vault_market. No read of v_guide_price_baseline.

BEGIN;

SET search_path TO vault_signals, vault_core, public;

CREATE SCHEMA IF NOT EXISTS vault_signals;

CREATE OR REPLACE FUNCTION vault_signals.signal_influence(
  p_signal_id uuid,
  p_at timestamptz
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT round(
    s.priority_score * power(
      0.5::numeric,
      GREATEST(EXTRACT(EPOCH FROM (p_at - s.first_seen_at))::numeric, 0)
        / 3600.0
        / st.default_half_life_hours
    ),
    6
  )
    FROM vault_signals.signal s
    JOIN vault_signals.signal_type st ON st.id = s.signal_type_id
   WHERE s.id = p_signal_id;
$$;

COMMENT ON FUNCTION vault_signals.signal_influence(uuid, timestamptz) IS
  'Read-time decay (G-2). priority_score * 0.5 ^ (hours_elapsed / half_life_hours). Half-life is signal_type.default_half_life_hours. Does not read attention_observation. Does not store a current value.';

-- Reads may_raise_valuation_ceiling. That column was unchecked by any reader before this function.
CREATE OR REPLACE FUNCTION vault_signals.assert_not_valuation_evidence(p_signal_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ceiling boolean;
  linked integer;
BEGIN
  SELECT bool_and(src.may_raise_valuation_ceiling), count(src.source_key)
    INTO ceiling, linked
    FROM vault_signals.signal s
    JOIN vault_signals.event_evidence ee ON ee.event_id = s.event_id
    JOIN vault_signals.raw_document d ON d.id = ee.raw_document_id
    JOIN vault_core.signals_news_source src ON src.source_key = d.source_id
   WHERE s.id = p_signal_id;

  IF linked IS NULL OR linked = 0 OR ceiling IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'valuation firewall: signal % cannot be joined into a valuation path (may_raise_valuation_ceiling is not true)',
      p_signal_id
      USING ERRCODE = '23514';
  END IF;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION vault_signals.assert_not_valuation_evidence(uuid) IS
  'Valuation firewall. A news-derived signal may annotate a valuation and may not become one. Fails while may_raise_valuation_ceiling is not true on every linked news source. Does not write vault_market.';

CREATE TABLE IF NOT EXISTS vault_signals.valuation_citation (
    id              UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    signal_id       UUID NOT NULL REFERENCES vault_signals.signal (id) ON DELETE RESTRICT,
    valuation_path  TEXT NOT NULL,
    attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vault_signals.valuation_citation IS
  'Firewall hook inside vault_signals. An insert calls assert_not_valuation_evidence and fails for news-derived rows. This is not a price and it does not write vault_market.';

CREATE OR REPLACE FUNCTION vault_signals.forbid_valuation_citation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM vault_signals.assert_not_valuation_evidence(NEW.signal_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_valuation_citation ON vault_signals.valuation_citation;
CREATE TRIGGER trg_forbid_valuation_citation
  BEFORE INSERT ON vault_signals.valuation_citation
  FOR EACH ROW
  EXECUTE FUNCTION vault_signals.forbid_valuation_citation();

COMMIT;
