"""Operator-saved councils created from Save team in the AI team panel."""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

yaml = pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")

import services.custom_councils as custom_councils  # noqa: E402
from services.custom_councils import (  # noqa: E402
    CustomCouncilError,
    create_custom_council,
    delete_custom_council,
    update_custom_council,
)
from services.registry import (  # noqa: E402
    clear_agent_cache,
    councils_public_list,
    get_council,
)


@pytest.fixture(autouse=True)
def isolated_custom_dir(tmp_path, monkeypatch: pytest.MonkeyPatch):
    target = tmp_path / "custom_councils"
    monkeypatch.setattr(custom_councils, "CUSTOM_COUNCILS_DIR", target)
    clear_agent_cache()
    yield target
    clear_agent_cache()


def _create(**overrides):
    payload = {
        "name": "Grading Board",
        "agents": ["grading_advisor", "critic"],
        "mode": "pipeline",
    }
    payload.update(overrides)
    return create_custom_council(payload)


def test_create_writes_unverified_council_and_lists_it():
    created = _create()
    assert created["id"] == "grading_board"
    card = get_council("grading_board")
    assert card is not None
    assert card["label"] == "Grading Board"
    assert card["agents"] == ["grading_advisor", "critic"]
    assert card["voting"] == "none"
    assert card["custom"] is True
    assert card["provenance"]["verification_status"] == "unverified"
    public = {c["id"]: c for c in councils_public_list()}
    assert public["grading_board"]["custom"] is True
    assert public["grading_board"]["label"] == "Grading Board"
    assert "analysis" in public


def test_create_refuses_shipped_council_name():
    with pytest.raises(CustomCouncilError, match="shipped"):
        _create(name="Analysis")


def test_create_refuses_unknown_role():
    with pytest.raises(CustomCouncilError, match="Unknown role"):
        _create(agents=["grading_advisor", "not_a_real_role"])


def test_create_refuses_duplicate_custom_id():
    _create()
    with pytest.raises(CustomCouncilError, match="already exists"):
        _create()


def test_update_renames_label_but_keeps_id():
    _create()
    updated = update_custom_council(
        "grading_board",
        {"name": "Grading Board v2", "agents": ["critic", "tester"]},
    )
    assert updated["id"] == "grading_board"
    card = get_council("grading_board")
    assert card["label"] == "Grading Board v2"
    assert card["agents"] == ["critic", "tester"]
    assert card["output_owner"] == "critic"


def test_update_refuses_shipped_council():
    with pytest.raises(CustomCouncilError, match="Shipped"):
        update_custom_council("analysis", {"name": "Nope"})


def test_delete_removes_custom_council_only():
    _create()
    assert get_council("grading_board") is not None
    deleted = delete_custom_council("grading_board")
    assert deleted["deleted"] is True
    assert get_council("grading_board") is None
    assert get_council("analysis") is not None


def test_delete_refuses_shipped_council():
    with pytest.raises(CustomCouncilError, match="Shipped"):
        delete_custom_council("build_spec")


def test_name_without_letters_or_digits_is_rejected():
    with pytest.raises(CustomCouncilError, match="letters or digits"):
        _create(name="!!!")
