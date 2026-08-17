"""SQL lives only under infra/db/migrations — no leftover root 01–08 copies."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from migrate_db import MIGRATIONS_DIR, migration_paths  # noqa: E402


def test_all_sql_migrations_live_in_infra():
    paths = migration_paths()
    assert paths, "expected dated SQL under infra/db/migrations"
    assert paths[0].name == "20260701_01_core_spine.sql"
    assert paths[0].parent == MIGRATIONS_DIR
    names = [p.name for p in paths]
    assert "20260702_02_tcg.sql" in names
    assert "20260809_01_binder_postgres.sql" in names
    assert names == sorted(names)


def test_repo_root_has_no_legacy_spine_sql():
    leftovers = list(REPO_ROOT.glob("0[1-8]_*.sql"))
    assert leftovers == [], leftovers


def test_no_duplicate_fable5_sql_folder():
    assert not (REPO_ROOT / "files -Fable5").exists()
