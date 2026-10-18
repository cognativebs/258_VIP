"""Promote a Console-made role to a shipped agent (operator review gate).

Runs against a temp copy of agents/ and config/ so the checkout is never edited.
"""
from __future__ import annotations

import os
import shutil
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

yaml = pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")

import services.contracts as contracts  # noqa: E402
import services.custom_agents as custom_agents  # noqa: E402
import services.registry as registry  # noqa: E402
from services.custom_agents import CustomAgentError, create_custom_agent, promote_custom_agent  # noqa: E402

ROLE = {
    "name": "Reprint Scout",
    "description": "Flags reprint risk before a grading spend",
    "skill": "Look for announced reprints and print-run signals before advising a grade.",
}


@pytest.fixture(autouse=True)
def sandbox(tmp_path, monkeypatch: pytest.MonkeyPatch):
    agents = tmp_path / "agents"
    config = tmp_path / "config"
    shutil.copytree(os.path.join(ORCH_ROOT, "agents"), agents)
    shutil.copytree(os.path.join(ORCH_ROOT, "config"), config)
    custom = tmp_path / "custom_agents"
    for mod, attr, value in [
        (custom_agents, "CUSTOM_AGENTS_DIR", custom),
        (contracts, "CUSTOM_AGENTS_DIR", custom),
        (custom_agents, "SHIPPED_AGENTS_DIR", agents),
        (custom_agents, "COUNCILS_PATH", config / "councils.yaml"),
        (custom_agents, "REGISTRY_PATH", agents / "registry.yaml"),
        (registry, "ROOT", tmp_path),
        (registry, "AGENTS_DIR", agents),
        (registry, "CONFIG_DIR", config),
        (contracts, "AGENTS_DIR", agents),
    ]:
        monkeypatch.setattr(mod, attr, value)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-proj-EXAMPLE")
    registry.clear_agent_cache()
    yield tmp_path
    registry.clear_agent_cache()


def test_promotion_ships_the_role_with_councils_pipeline_and_reviewed_provenance(sandbox):
    created = create_custom_agent(ROLE)
    out = promote_custom_agent(created["id"], {"councils": ["curation"], "reviewed": True, "reviewer": "Greg", "note": "useful before grading"})
    aid = out["id"]
    assert out["councils"] == ["curation", "full"]

    meta = registry.load_agents()[aid]
    assert "custom" not in meta
    assert meta["provenance"]["verification_status"] == "operator_reviewed"
    assert meta["provenance"]["reviewed_by"] == "Greg"
    assert registry.load_skill_text(aid).startswith("# Reprint Scout")

    councils = registry.load_councils()["councils"]
    assert aid in councils["curation"]["agents"] and aid in councils["full"]["agents"]
    assert aid in registry.load_registry_index()["pipeline_order"]
    # Comments in the edited YAML survive.
    assert "# Orchestr8 councils" in (sandbox / "config" / "councils.yaml").read_text(encoding="utf-8")
    assert "# Orchestr8 agent registry index" in (sandbox / "agents" / "registry.yaml").read_text(encoding="utf-8")
    # The Console copy is archived, not erased.
    assert not (sandbox / "custom_agents" / aid).exists()
    assert list((sandbox / "custom_agents" / ".promoted").glob(f"{aid}-*"))


@pytest.mark.parametrize(
    "payload,match",
    [
        ({"councils": ["curation"]}, "reviewed"),
        ({"councils": [], "reviewed": True}, "at least one shipped council"),
        ({"councils": ["full"], "reviewed": True}, "at least one shipped council"),
        ({"councils": ["nope"], "reviewed": True}, "Unknown or custom council"),
    ],
)
def test_promotion_needs_a_review_and_a_real_council(payload, match):
    aid = create_custom_agent(ROLE)["id"]
    with pytest.raises(CustomAgentError, match=match):
        promote_custom_agent(aid, payload)
    # Nothing moved.
    assert "custom" in registry.load_agents()[aid]


def test_shipped_and_unknown_roles_cannot_be_promoted():
    with pytest.raises(CustomAgentError, match="Unknown custom role"):
        promote_custom_agent("critic", {"councils": ["challenge"], "reviewed": True})
    with pytest.raises(CustomAgentError, match="Unknown custom role"):
        promote_custom_agent("ghost", {"councils": ["challenge"], "reviewed": True})


def test_insert_list_item_keeps_layout():
    text = "councils:\n  a:\n    agents:\n      - x\n      - y\n    voting: none\n  b:\n    agents:\n      - z\n"
    out = custom_agents._insert_list_item(text, block_header=__import__("re").compile(r"^  a:\s*$"), list_key="agents", item="new")
    assert out == "councils:\n  a:\n    agents:\n      - x\n      - y\n      - new\n    voting: none\n  b:\n    agents:\n      - z\n"
