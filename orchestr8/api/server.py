#!/usr/bin/env python3
"""Orchestr8 AI Gateway — role-based multi-provider orchestration."""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from providers.billing import accounts_snapshot  # noqa: E402
from services.orchestrator import run_job  # noqa: E402
from services.planner import plan_job  # noqa: E402
from services.registry import (  # noqa: E402
    agents_public_list,
    clear_agent_cache,
    councils_public_list,
    load_registry_index,
    models_public_list,
    pipeline_order as registry_pipeline_order,
)
from services.roles import configured_providers, load_config  # noqa: E402

PORT = int(os.environ.get("ORCHESTR8_PORT", "5210"))


def json_response(handler: BaseHTTPRequestHandler, status: int, body: dict) -> None:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", 0))
    raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
    return json.loads(raw) if raw.strip() else {}


class GatewayHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def _sse(self, obj: dict) -> None:
        self.wfile.write(f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8"))
        self.wfile.flush()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/v1/health":
            providers = configured_providers()
            json_response(
                self,
                200,
                {
                    "ok": any(providers.values()),
                    "service": "orchestr8",
                    "providers": providers,
                },
            )
            return

        if path == "/v1/roles":
            # Legacy endpoint — prefer /v1/agents for full registry
            cfg = load_config()
            roles = []
            for rid, meta in cfg["roles"].items():
                prov = meta["provider"]
                roles.append(
                    {
                        "id": rid,
                        "label": meta["label"],
                        "provider": prov,
                        "providerLabel": meta.get("provider_label", prov),
                        "description": meta.get("description", ""),
                        "configured": configured_providers().get(prov, False),
                    }
                )
            json_response(self, 200, {"roles": roles, "pipelineOrder": cfg["pipeline_order"]})
            return

        if path == "/v1/agents":
            idx = load_registry_index()
            json_response(
                self,
                200,
                {
                    "agents": agents_public_list(),
                    "pipelineOrder": registry_pipeline_order(),
                    "legacyAliases": idx.get("legacy_aliases") or {},
                },
            )
            return

        if path in ("/v1/models", "/v1/pricing"):
            json_response(self, 200, models_public_list())
            return

        if path == "/v1/councils":
            json_response(self, 200, {"councils": councils_public_list()})
            return

        if path == "/v1/accounts":
            json_response(self, 200, {"accounts": accounts_snapshot()})
            return

        json_response(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path

        if path == "/v1/reload":
            clear_agent_cache()
            json_response(self, 200, {"ok": True, "agents": len(agents_public_list())})
            return

        if path == "/v1/plan":
            try:
                body = read_json(self)
                inp = body.get("input") or {}
                question = inp.get("question") or body.get("question") or ""
                context_json = inp.get("contextJson") or body.get("contextJson") or "{}"
                if isinstance(context_json, dict):
                    context_json = json.dumps(context_json)
                plan = plan_job(
                    task=body.get("task") or "general",
                    question=question,
                    context_json=context_json,
                    budget_usd=body.get("budgetUsd") if body.get("budgetUsd") is not None else body.get("budget_usd"),
                    quality=body.get("quality") or "balanced",
                    max_agents=body.get("maxAgents") or body.get("max_agents"),
                    prefer_council=body.get("council"),
                )
                json_response(self, 200, plan)
            except Exception as e:  # noqa: BLE001
                json_response(self, 500, {"error": str(e)})
            return

        if path == "/v1/jobs/stream":
            self._handle_job_stream()
            return

        if path != "/v1/jobs":
            json_response(self, 404, {"error": "Not found"})
            return

        try:
            body = read_json(self)
            task = body.get("task") or "general"
            roles = body.get("roles") or []
            mode = body.get("mode") or ("single" if len(roles) <= 1 else "pipeline")
            inp = body.get("input") or {}
            messages = inp.get("messages") or []
            question = inp.get("question") or (messages[-1]["content"] if messages else "")
            context_json = inp.get("contextJson") or inp.get("context") or "{}"
            if isinstance(context_json, dict):
                context_json = json.dumps(context_json)

            model_overrides = body.get("model_overrides") or body.get("modelOverrides") or {}
            if not isinstance(model_overrides, dict):
                model_overrides = {}

            council = body.get("council") or None

            result = run_job(
                task=task,
                roles=roles,
                mode=mode,
                question=question,
                context_json=context_json,
                model_overrides=model_overrides,
                council=council,
            )
            json_response(self, 200, result)
        except Exception as e:
            json_response(self, 500, {"error": str(e)})

    def _handle_job_stream(self) -> None:
        """SSE: emit one frame per completed agent step, then a final result."""
        try:
            body = read_json(self)
        except Exception as e:  # noqa: BLE001
            json_response(self, 400, {"error": f"Bad request: {e}"})
            return

        roles = body.get("roles") or []
        mode = body.get("mode") or ("single" if len(roles) <= 1 else "pipeline")
        inp = body.get("input") or {}
        messages = inp.get("messages") or []
        question = inp.get("question") or (messages[-1]["content"] if messages else "")
        context_json = inp.get("contextJson") or inp.get("context") or "{}"
        if isinstance(context_json, dict):
            context_json = json.dumps(context_json)
        model_overrides = body.get("model_overrides") or body.get("modelOverrides") or {}
        if not isinstance(model_overrides, dict):
            model_overrides = {}

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        try:
            self._sse({"type": "start", "roles": roles, "mode": mode})
            result = run_job(
                task=body.get("task") or "general",
                roles=roles,
                mode=mode,
                question=question,
                context_json=context_json,
                model_overrides=model_overrides,
                council=body.get("council") or None,
                on_step=lambda step: self._sse({"type": "step", "step": step}),
            )
            self._sse({"type": "done", "result": result})
        except Exception as e:  # noqa: BLE001
            try:
                self._sse({"type": "error", "error": str(e)})
            except Exception:  # noqa: BLE001 — client may have disconnected
                pass


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), GatewayHandler)
    print(f"Orchestr8 AI Gateway on http://127.0.0.1:{PORT}")
    print("  GET  /v1/health")
    print("  GET  /v1/roles")
    print("  GET  /v1/agents")
    print("  GET  /v1/models")
    print("  GET  /v1/councils")
    print("  GET  /v1/pricing")
    print("  GET  /v1/accounts")
    print("  POST /v1/jobs")
    print("  POST /v1/jobs/stream (SSE)")
    print("  POST /v1/plan")
    print("  POST /v1/reload")
    print(f"  Providers: {configured_providers()}")
    print(f"  Agents: {len(agents_public_list())}")
    server.serve_forever()


if __name__ == "__main__":
    main()
