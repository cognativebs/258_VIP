-- ============================================================================
-- FIX for 01_core_spine.sql — verified bug, July 4 2026 audit
--
-- Problem: 01 runs `SET search_path TO vault_core, public;` BEFORE creating
-- extensions, so uuid-ossp / pg_trgm / pgvector install INTO vault_core.
-- Migration 06 then sets `search_path TO vault_platform, public` and can no
-- longer see uuid_generate_v4() -> "function uuid_generate_v4() does not exist".
--
-- Fix (choose one):
--
-- A) If starting fresh: in 01_core_spine.sql, replace lines 10-12 with the
--    three CREATE EXTENSION lines below (pin them to public explicitly),
--    keeping them AFTER the SET search_path line is fine once SCHEMA is pinned.
--
-- B) If the DB already exists: run this file once, then re-run 06.
-- ============================================================================

-- Option B — repair an existing database:
ALTER EXTENSION "uuid-ossp" SET SCHEMA public;
ALTER EXTENSION pg_trgm     SET SCHEMA public;
-- pgvector cannot be relocated after objects use it; leave it, or rebuild.

-- Option A — the corrected lines for 01_core_spine.sql:
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;
-- CREATE EXTENSION IF NOT EXISTS pg_trgm     SCHEMA public;
-- CREATE EXTENSION IF NOT EXISTS vector      SCHEMA public;

-- ============================================================================
-- Two more hardening notes from the test run:
--
-- 1) pgvector is NOT optional as written. Line 12's comment says "optional
--    but recommended" but line 69 (asset.image_embedding vector(512)) and
--    line 83 (ivfflat index) hard-require it. On stock Postgres without
--    pgvector, 01 dies at line 12 and ALL SIX migrations cascade-fail.
--    Either make it truly required (document it) or gate the embedding
--    column/index behind a separate optional migration (recommended:
--    07_vector_optional.sql). Supabase/Railway/Neon all ship pgvector,
--    so if you host there, just document the dependency.
--
-- 2) Wrap each migration in BEGIN; ... COMMIT;. During testing, a partial
--    failure of 06 left vault_platform.tool created but tool_user missing,
--    and the re-run failed with "relation tool already exists". Transactions
--    make every migration all-or-nothing and safely re-runnable.
-- ============================================================================
