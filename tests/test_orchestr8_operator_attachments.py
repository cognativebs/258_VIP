"""Operator attachments injected into Build Spec context."""
from __future__ import annotations

import json
import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORCH_ROOT = os.path.join(REPO_ROOT, "orchestr8")
if ORCH_ROOT not in sys.path:
    sys.path.insert(0, ORCH_ROOT)

from services.operator_attachments import (  # noqa: E402
    format_for_prompt,
    merge_into_context,
    normalize_attachments,
    normalize_ref_paths,
    summarize_for_collection_json,
)

# Heavy imports (registry → PyYAML) stay inside tests so the ingest CI job
# can collect this module without orchestr8/requirements.txt.


def test_normalize_drops_empty_and_caps_count():
    raw = [{"name": "a.md", "text": "hello"}] + [{"name": f"{i}.md", "text": "x"} for i in range(20)]
    out = normalize_attachments(raw)
    assert len(out) <= 8
    assert out[0]["name"] == "a.md"


def test_ref_paths_reject_parent_and_absolute():
    assert normalize_ref_paths(["../secret", "/etc/passwd", "docs/ok.md"]) == ["docs/ok.md"]
    assert normalize_ref_paths(["docs/photo.png"]) == []


def test_merge_reads_repo_path():
    pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")
    ctx = merge_into_context(
        {
            "operatorAttachments": [{"name": "notes.md", "text": "from upload", "source": "upload"}],
            "operatorRefPaths": ["AGENTS.md"],
        }
    )
    names = [a["name"] for a in ctx["operatorAttachments"]]
    assert "notes.md" in names
    assert any(n.endswith("AGENTS.md") or n == "AGENTS.md" for n in names)
    agents = next(a for a in ctx["operatorAttachments"] if "AGENTS" in a["name"])
    assert "VIP" in agents["text"] or "Vault" in agents["text"]


def test_user_prompt_includes_attachments():
    pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")
    from services.orchestrator import _build_user_prompt

    ctx = json.dumps(
        {
            "operatorAttachments": [
                {"name": "viture-notes.md", "text": "Luma Ultra 3DoF on iOS", "source": "paste"}
            ]
        }
    )
    prompt = _build_user_prompt(
        agent_id="architect",
        task="build_spec",
        question="Spec the HUD",
        context_json=ctx,
        trace=[],
        mode="pipeline",
    )
    assert "OPERATOR ATTACHMENTS" in prompt
    assert "Luma Ultra 3DoF on iOS" in prompt
    collection = prompt.split("--- COLLECTION CONTEXT (JSON) ---")[1].split("---")[0]
    assert "Luma Ultra 3DoF on iOS" not in collection
    assert "viture-notes.md" in collection


def test_ensure_repo_context_keeps_attachments():
    pytest.importorskip("yaml", reason="orchestr8/requirements.txt not installed")
    from services.orchestrator import _ensure_repo_context

    raw = json.dumps(
        {
            "operatorAttachments": [{"name": "a.md", "text": "keep me"}],
            "operatorRefPaths": ["AGENTS.md"],
            "adr": "0003",
        }
    )
    out = json.loads(_ensure_repo_context(raw))
    assert out["operatorAttachments"]
    assert any(a["text"] == "keep me" for a in out["operatorAttachments"])
    assert "repoContext" in out


def test_format_for_prompt_empty():
    assert format_for_prompt([]) == ""


def test_summarize_strips_attachment_bodies():
    slim = summarize_for_collection_json(
        {
            "adr": "0003",
            "operatorAttachments": [{"name": "a.md", "text": "SECRET BODY", "source": "paste"}],
        }
    )
    assert slim["adr"] == "0003"
    assert slim["operatorAttachments"] == [{"name": "a.md", "source": "paste", "chars": 11}]
