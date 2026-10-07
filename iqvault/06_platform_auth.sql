-- IQVault Platform — 06: AUTH & CROSS-TOOL LINKING
-- Separate logins per tool; linked accounts share catalog + signal data

CREATE SCHEMA IF NOT EXISTS vault_platform;
SET search_path TO vault_platform, public;

-- ── Tool registry ────────────────────────────────────────────────────────────

CREATE TABLE vault_platform.tool (
    id              SMALLINT PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT
);

INSERT INTO vault_platform.tool (id, slug, name, description) VALUES
    (1, 'vaultos', 'VaultOS', 'Subscription store operations — scan, identify, acquire'),
    (2, 'iqvault', 'IQVault', 'Personal intelligence — hunts, portfolio, insights')
ON CONFLICT (slug) DO NOTHING;

-- ── Users (one row per tool login — same person may have two accounts) ───────

CREATE TABLE vault_platform.tool_user (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tool_id         SMALLINT NOT NULL REFERENCES vault_platform.tool(id),
    email           TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT DEFAULT 'user',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tool_id, email)
);

-- ── Account links (explicit opt-in between VaultOS ↔ IQVault) ────────────────

CREATE TABLE vault_platform.account_link (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vaultos_user_id UUID NOT NULL REFERENCES vault_platform.tool_user(id),
    iqvault_user_id UUID NOT NULL REFERENCES vault_platform.tool_user(id),
    link_code       TEXT,
    linked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    UNIQUE (vaultos_user_id, iqvault_user_id)
);

CREATE INDEX idx_account_link_vaultos ON vault_platform.account_link (vaultos_user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_account_link_iqvault ON vault_platform.account_link (iqvault_user_id) WHERE revoked_at IS NULL;

-- ── Sync payloads (information sharing bus) ──────────────────────────────────

CREATE TABLE vault_platform.sync_event (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    link_id         UUID NOT NULL REFERENCES vault_platform.account_link(id) ON DELETE CASCADE,
    source_tool_id  SMALLINT NOT NULL REFERENCES vault_platform.tool(id),
    payload         JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_event_link ON vault_platform.sync_event (link_id, created_at DESC);

COMMENT ON SCHEMA vault_platform IS 'Cross-tool auth linking and data bus for VaultOS + IQVault';
