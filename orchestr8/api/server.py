#!/usr/bin/env python3
"""Orchestr8 AI Gateway — role-based multi-provider orchestration."""
from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from providers.billing import accounts_snapshot  # noqa: E402
from api.runs_routes import handle_get_run, handle_list_runs  # noqa: E402
from api.specs_routes import handle_get_spec, handle_list_specs  # noqa: E402
from services.custom_agents import CustomAgentError, create_custom_agent, update_custom_agent  # noqa: E402
from services.custom_councils import (  # noqa: E402
    CustomCouncilError,
    create_custom_council,
    delete_custom_council,
    update_custom_council,
)
from services.orchestrator import resume_job, run_job  # noqa: E402
from services.planner import plan_job  # noqa: E402
from services.registry import (  # noqa: E402
    agents_public_list,
    agent_public_detail,
    clear_agent_cache,
    councils_public_list,
    load_registry_index,
    models_public_list,
    pipeline_order as registry_pipeline_order,
)
from services.provider_env import configured_providers, env_file_present, provider_key_warnings  # noqa: E402
from services.roles import load_config  # noqa: E402

PORT = int(os.environ.get("ORCHESTR8_PORT", "5210"))
# Keepalive cadence for /v1/jobs/stream. Must stay well under the console stall
# watchdog (10 min of SSE silence) so a slow role is never mistaken for a dead
# gateway. Override for tests via ORCHESTR8_SSE_HEARTBEAT_SECONDS.
SSE_HEARTBEAT_SECONDS = float(os.environ.get("ORCHESTR8_SSE_HEARTBEAT_SECONDS", "20"))


def _id_from_path(path: str, prefix: str) -> str | None:
    if not path.startswith(prefix):
        return None
    rest = path[len(prefix) :]
    if not rest or "/" in rest:
        return None
    return rest


def _agent_id_from_path(path: str) -> str | None:
    return _id_from_path(path, "/v1/agents/")


def _council_id_from_path(path: str) -> str | None:
    return _id_from_path(path, "/v1/councils/")


def json_response(handler: BaseHTTPRequestHandler, status: int, body: dict) -> None:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/v1/health":
            providers = configured_providers()
            warnings = provider_key_warnings()
            body: dict = {
                "ok": any(providers.values()),
                "service": "orchestr8",
                "providers": providers,
            }
            if warnings:
                body["keyWarnings"] = warnings
            json_response(self, 200, body)
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

        agent_id = _agent_id_from_path(path)
        if agent_id:
            try:
                json_response(self, 200, {"ok": True, "agent": agent_public_detail(agent_id)})
            except ValueError as e:
                json_response(self, 404, {"error": "not_found", "detail": str(e)})
            except Exception as e:  # noqa: BLE001
                json_response(self, 500, {"error": str(e)})
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

        if path == "/v1/runs":
            status, body = handle_list_runs()
            json_response(self, status, body)
            return

        if path.startswith("/v1/runs/"):
            run_id = path[len("/v1/runs/") :]
            if not run_id or "/" in run_id:
                json_response(self, 404, {"error": "Not found"})
                return
            status, body = handle_get_run(run_id)
            json_response(self, status, body)
            return

        if path == "/v1/specs":
            status, body = handle_list_specs()
            json_response(self, status, body)
            return

        if path.startswith("/v1/specs/"):
            spec_id = path[len("/v1/specs/") :]
            if not spec_id or "/" in spec_id:
                json_response(self, 404, {"error": "Not found"})
                return
            status, body = handle_get_spec(spec_id)
            json_response(self, status, body)
            return

        json_response(self, 404, {"error": "Not found"})

    def _update_agent(self, agent_id: str) -> None:
        try:
            updated = update_custom_agent(agent_id, read_json(self))
            agent = next(
                (a for a in agents_public_list() if a["id"] == updated["id"]), None
            )
            json_response(self, 200, {"ok": True, **updated, "agent": agent})
        except CustomAgentError as e:
            json_response(self, 400, {"error": "invalid_agent", "detail": str(e)})
        except Exception as e:  # noqa: BLE001
            json_response(self, 500, {"error": str(e)})

    def _update_council(self, council_id: str) -> None:
        try:
            updated = update_custom_council(council_id, read_json(self))
            json_response(self, 200, {"ok": True, **updated})
        except CustomCouncilError as e:
            json_response(self, 400, {"error": "invalid_council", "detail": str(e)})
        except Exception as e:  # noqa: BLE001
            json_response(self, 500, {"error": str(e)})

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path
        council_id = _council_id_from_path(path)
        if council_id:
            self._update_council(council_id)
            return
        agent_id = _agent_id_from_path(path)
        if not agent_id:
            json_response(self, 404, {"error": "Not found"})
            return
        self._update_agent(agent_id)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if path == "/v1/runs" or path.startswith("/v1/runs/"):
            json_response(self, 405, {"error": "method_not_allowed", "detail": "Runs API is read-only"})
            return
        council_id = _council_id_from_path(path)
        if council_id:
            try:
                deleted = delete_custom_council(council_id)
                json_response(self, 200, {"ok": True, **deleted})
            except CustomCouncilError as e:
                json_response(self, 400, {"error": "invalid_council", "detail": str(e)})
            except Exception as e:  # noqa: BLE001
                json_response(self, 500, {"error": str(e)})
            return
        json_response(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path

        if path == "/v1/runs" or path.startswith("/v1/runs/"):
            json_response(self, 405, {"error": "method_not_allowed", "detail": "Runs API is read-only"})
            return

        if path == "/v1/reload":
            clear_agent_cache()
            json_response(self, 200, {"ok": True, "agents": len(agents_public_list())})
            return

        if path == "/v1/agents":
            try:
                created = create_custom_agent(read_json(self))
                agent = next(
                    (a for a in agents_public_list() if a["id"] == created["id"]), None
                )
                json_response(self, 201, {"ok": True, **created, "agent": agent})
            except CustomAgentError as e:
                json_response(self, 400, {"error": "invalid_agent", "detail": str(e)})
            except Exception as e:  # noqa: BLE001
                json_response(self, 500, {"error": str(e)})
            return

        if path == "/v1/councils":
            try:
                created = create_custom_council(read_json(self))
                json_response(self, 201, {"ok": True, **created})
            except CustomCouncilError as e:
                json_response(self, 400, {"error": "invalid_council", "detail": str(e)})
            except Exception as e:  # noqa: BLE001
                json_response(self, 500, {"error": str(e)})
            return

        agent_id = _agent_id_from_path(path)
        if agent_id:
            self._update_agent(agent_id)
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

        resume_id = body.get("resumeFromRunId") or body.get("resume_from_run_id")
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

        # A single role can legitimately hold the stream silent for many minutes:
        # the socket timeout scales to 480s and _chat_role_retry adds a second
        # attempt, so one slow reasoning role can exceed the console's 10-minute
        # stall watchdog and get a healthy council killed in the UI. Emit a
        # heartbeat so silence means "gateway died", not "role is thinking".
        # No message/role field, so the dock keeps the last real progress text.
        sse_lock = threading.Lock()
        stop_heartbeat = threading.Event()

        def send(obj: dict) -> None:
            with sse_lock:
                self._sse(obj)

        def heartbeat() -> None:
            while not stop_heartbeat.wait(SSE_HEARTBEAT_SECONDS):
                try:
                    send({"type": "progress", "phase": "heartbeat"})
                except Exception:  # noqa: BLE001 — client disconnected; stop quietly
                    return

        hb = threading.Thread(target=heartbeat, name="sse-heartbeat", daemon=True)
        hb.start()
        try:
            send({"type": "start", "roles": roles, "mode": mode, "resumeFromRunId": resume_id})
            if resume_id:
                result = resume_job(
                    str(resume_id),
                    on_step=lambda step: send({"type": "step", "step": step}),
                    on_progress=lambda p: send({"type": "progress", **(p or {})}),
                )
            else:
                result = run_job(
                    task=body.get("task") or "general",
                    roles=roles,
                    mode=mode,
                    question=question,
                    context_json=context_json,
                    model_overrides=model_overrides,
                    council=body.get("council") or None,
                    on_step=lambda step: send({"type": "step", "step": step}),
                    on_progress=lambda p: send({"type": "progress", **(p or {})}),
                )
            stop_heartbeat.set()
            send({"type": "done", "result": result})
        except Exception as e:  # noqa: BLE001
            stop_heartbeat.set()
            try:
                send({"type": "error", "error": str(e)})
            except Exception:  # noqa: BLE001 — client may have disconnected
                pass
        finally:
            stop_heartbeat.set()


def main() -> None:
    # Without this the banner and the WARN lines below sit in a block buffer
    # whenever stdout is redirected to a launcher log, so an operator debugging
    # "gateway offline" sees an empty log file and no missing-key warning.
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, OSError):  # pragma: no cover - non-standard stdout
        pass
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), GatewayHandler)
    except OSError as e:
        print(f"Bind failed on 127.0.0.1:{PORT}: {e}")
        print("Usually a stale gateway is still listening (HealthBar shows gateway offline).")
        print(f"  netstat -ano | findstr :{PORT}")
        print("  taskkill /PID <pid> /F")
        print("Or: start_orchestr8.bat after killing that PID.")
        raise SystemExit(1) from e
    print(f"Orchestr8 AI Gateway on http://127.0.0.1:{PORT}")
    print("  GET  /v1/health")
    print("  GET  /v1/roles")
    print("  GET  /v1/agents")
    print("  GET  /v1/agents/:id")
    print("  POST /v1/agents")
    print("  PATCH /v1/agents/:id")
    print("  GET  /v1/models")
    print("  GET  /v1/councils")
    print("  GET  /v1/pricing")
    print("  GET  /v1/accounts")
    print("  GET  /v1/runs")
    print("  GET  /v1/runs/:id")
    print("  GET  /v1/specs")
    print("  GET  /v1/specs/:id")
    print("  POST /v1/jobs")
    print("  POST /v1/jobs/stream (SSE; resumeFromRunId to continue a credit pause)")
    print("  POST /v1/plan")
    print("  POST /v1/reload")
    print(f"  Providers: {configured_providers()}")
    print(f"  Agents: {len(agents_public_list())}")
    if not env_file_present():
        print("  WARN: orchestr8/.env is missing — copy orchestr8/.env.example and add keys.")
    for warn in provider_key_warnings():
        print(f"  WARN: {warn}")
    server.serve_forever()


if __name__ == "__main__":
    main()
