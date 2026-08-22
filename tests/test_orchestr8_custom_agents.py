"""Operator-authored roles created from the Console team panel.

A role created through the UI has to be indistinguishable from a shipped one at
run time — loadable by the registry, resolvable to a model, and covered by a
valid contract — while still being clearly marked unverified.
"""
from __future__ import annotations

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

yaml = pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")

import services.contracts as contracts  # noqa: E402
import services.custom_agents as custom_agents  # noqa: E402
from services.contracts import load_contract, validate_contract  # noqa: E402
from services.custom_agents import (  # noqa: E402
    CustomAgentError,
    create_custom_agent,
    slugify,
    update_custom_agent,
)
from services.registry import (  # noqa: E402
    agent_public_detail,
    agents_public_list,
    clear_agent_cache,
    load_agents,
    load_skill_text,
    resolve_model,
)
from services.registry import (  # noqa: E402
    agents_public_list,
    clear_agent_cache,
    load_agents,
    load_skill_text,
    resolve_model,
)

VALID = {
    "name": "Reprint Scout",
    "description": "Flags reprint risk before a grading spend",
    "skill": "Look for announced reprints and print-run signals before advising a grade.",
}


@pytest.fixture(autouse=True)
def isolated_custom_dir(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Write custom roles to a temp dir so the repo checkout stays clean."""
    target = tmp_path / "custom_agents"
    monkeypatch.setattr(custom_agents, "CUSTOM_AGENTS_DIR", target)
    monkeypatch.setattr(contracts, "CUSTOM_AGENTS_DIR", target)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-proj-EXAMPLE")
    clear_agent_cache()
    yield target
    clear_agent_cache()


# --- id derivation ------------------------------------------------------------

@pytest.mark.parametrize(
    "name,expected",
    [
        ("Reprint Scout", "reprint_scout"),
        ("  Grading   Advisor  ", "grading_advisor"),
        ("Set/Rotation Watch", "set_rotation_watch"),
        ("Scout 2.0", "scout_2_0"),
    ],
)
def test_slugify(name: str, expected: str):
    assert slugify(name) == expected


def test_name_without_letters_or_digits_is_rejected():
    with pytest.raises(CustomAgentError, match="no letters or digits"):
        create_custom_agent({**VALID, "name": "!!!!"})


# --- creation -----------------------------------------------------------------

def test_create_writes_agent_contract_and_skill(isolated_custom_dir):
    created = create_custom_agent(VALID)
    assert created["id"] == "reprint_scout"

    role_dir = isolated_custom_dir / "reprint_scout"
    assert (role_dir / "agent.yaml").exists()
    assert (role_dir / "contract.yaml").exists()
    assert (role_dir / "skill.md").exists()

    agent = yaml.safe_load((role_dir / "agent.yaml").read_text(encoding="utf-8"))
    assert agent["label"] == "Reprint Scout"
    assert agent["description"] == VALID["description"]
    assert agent["enabled"] is True
    assert agent["custom"] is True


def test_created_role_carries_unverified_provenance():
    create_custom_agent(VALID)
    prov = load_agents()["reprint_scout"]["provenance"]
    assert prov["source"] == "console_ui"
    assert prov["method"] == "operator_authored"
    assert prov["verification_status"] == "unverified"
    assert prov["created_at"]


def test_created_role_has_a_schema_valid_contract():
    """AGENTS.md rule 6 — validate_contracts.py must still pass with custom roles."""
    create_custom_agent(VALID)
    contract = load_contract("reprint_scout")
    assert contract is not None
    assert validate_contract(contract) == []
    assert contract["id"] == "reprint_scout"


def test_created_role_gets_no_tools_until_reviewed():
    create_custom_agent(VALID)
    assert load_contract("reprint_scout")["allowed_tools"] == []


def test_created_role_is_registered_and_runnable():
    create_custom_agent(VALID)
    assert "reprint_scout" in load_agents()

    resolved = resolve_model("reprint_scout")
    assert resolved["model"]
    assert resolved["provider"] == "openai"  # only key set in this fixture

    skill = load_skill_text("reprint_scout")
    assert VALID["skill"] in skill


def test_created_role_appears_on_the_team_panel_marked_custom():
    create_custom_agent(VALID)
    card = next(a for a in agents_public_list() if a["id"] == "reprint_scout")
    assert card["label"] == "Reprint Scout"
    assert card["custom"] is True
    assert card["verificationStatus"] == "unverified"
    # Open selection applies to custom roles too.
    assert len(card["allowedModels"]) == len(agents_public_list()[0]["allowedModels"])


def test_built_in_roles_are_not_marked_custom():
    assert next(a for a in agents_public_list() if a["id"] == "critic")["custom"] is False


# --- rejections ---------------------------------------------------------------

def test_cannot_shadow_a_built_in_role():
    with pytest.raises(CustomAgentError, match="already exists"):
        create_custom_agent({**VALID, "name": "Critic"})


def test_cannot_shadow_a_legacy_alias():
    with pytest.raises(CustomAgentError, match="already exists"):
        create_custom_agent({**VALID, "name": "QC QA"})


def test_cannot_create_the_same_custom_role_twice():
    create_custom_agent(VALID)
    with pytest.raises(CustomAgentError, match="already exists"):
        create_custom_agent(VALID)


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", "R"),
        ("description", "too short"),
        ("skill", "thin"),
    ],
)
def test_thin_input_is_rejected(field: str, value: str):
    with pytest.raises(CustomAgentError):
        create_custom_agent({**VALID, field: value})


@pytest.mark.parametrize("field", ["name", "description", "skill"])
def test_missing_field_is_rejected(field: str):
    payload = {k: v for k, v in VALID.items() if k != field}
    with pytest.raises(CustomAgentError, match="missing required"):
        create_custom_agent(payload)


def test_unknown_model_is_rejected():
    with pytest.raises(CustomAgentError, match="Unknown model in catalog"):
        create_custom_agent({**VALID, "defaultModel": "gpt-9-imaginary"})


def test_explicit_model_is_honoured():
    create_custom_agent({**VALID, "defaultModel": "claude-fable-5"})
    resolved = resolve_model("reprint_scout")
    assert resolved["model"] == "claude-fable-5"
    assert resolved["provider"] == "anthropic"


def test_default_model_prefers_a_provider_that_has_a_key(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("XAI_API_KEY", "xai-EXAMPLE")
    create_custom_agent(VALID)
    assert resolve_model("reprint_scout")["provider"] == "grok"


# --- edit ---------------------------------------------------------------------

def test_update_rewrites_name_description_and_skill_in_place(isolated_custom_dir):
    create_custom_agent(VALID)
    update_custom_agent(
        "reprint_scout",
        {
            "name": "Reprint Watch",
            "description": "Watches announced reprints before a grading spend",
            "skill": "Prioritise official reprint notices over rumour. State confidence.",
        },
    )
    meta = load_agents()["reprint_scout"]
    assert meta["id"] == "reprint_scout"
    assert meta["label"] == "Reprint Watch"
    assert meta["description"].startswith("Watches announced reprints")
    assert "official reprint notices" in load_skill_text("reprint_scout")
    assert load_contract("reprint_scout")["mission"].startswith("Watches announced")


def test_update_does_not_change_the_agent_id():
    create_custom_agent(VALID)
    updated = update_custom_agent(
        "reprint_scout",
        {
            "name": "Totally Different Name",
            "description": "Still the same role under a new label for the card",
            "skill": "Keep the original id so saved teams keep resolving this role.",
        },
    )
    assert updated["id"] == "reprint_scout"
    assert "reprint_scout" in load_agents()
    assert "totally_different_name" not in load_agents()


def test_edit_of_a_shipped_role_writes_an_overlay_not_the_source(isolated_custom_dir):
    from pathlib import Path

    shipped = Path(ORCH_ROOT) / "agents" / "critic" / "agent.yaml"
    before = shipped.read_text(encoding="utf-8")
    update_custom_agent(
        "critic",
        {
            "name": "Chief Critic",
            "description": "Locally retitled critic for a one-off challenge pass",
            "skill": "Be harsher on unverified grades. Still veto on critical gaps.",
        },
    )
    assert shipped.read_text(encoding="utf-8") == before
    assert (isolated_custom_dir / "critic" / "agent.yaml").exists()
    meta = load_agents()["critic"]
    assert meta["label"] == "Chief Critic"
    card = next(a for a in agents_public_list() if a["id"] == "critic")
    assert card["edited"] is True
    assert card["custom"] is False
    assert "harsher on unverified grades" in load_skill_text("critic")


def test_unknown_agent_cannot_be_edited():
    with pytest.raises(CustomAgentError, match="Unknown agent"):
        update_custom_agent(
            "no_such_role",
            {
                "name": "Ghost",
                "description": "Does not exist and must not be created this way",
                "skill": "Editing a missing role is not a back door into create.",
            },
        )


def test_detail_returns_skill_text_for_the_editor():
    create_custom_agent(VALID)
    detail = agent_public_detail("reprint_scout")
    assert VALID["skill"] in detail["skill"]
    assert detail["label"] == "Reprint Scout"
