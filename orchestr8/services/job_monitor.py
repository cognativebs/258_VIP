"""Live view of one streamed job: which model calls are in flight, what has
finished, what it has cost so far — and a cancel flag the stream sets when the
client goes away, so no further role is called (and billed) after Stop.

A call already in flight cannot be recalled; cancellation stops the next one.
"""
from __future__ import annotations

import threading
import time


class JobCancelled(Exception):
    """Raised before a model call once the client has stopped the job."""


class JobMonitor:
    def __init__(self, clock=time.time) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._started = clock()
        self._in_flight: dict[str, dict] = {}
        self._done: list[dict] = []
        self._cancelled = False
        self._calls = 0

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def cancel(self) -> None:
        self._cancelled = True

    def check(self, role: str) -> None:
        if self._cancelled:
            raise JobCancelled(f"stopped by operator before {role} was called")

    def call_started(self, *, role: str, label: str, provider: str, model: str, attempt: int, timeout_s: int) -> None:
        with self._lock:
            self._calls += 1
            self._in_flight[role] = {
                "role": role,
                "label": label,
                "provider": provider,
                "model": model,
                "attempt": attempt,
                "timeoutS": timeout_s,
                "startedAt": self._clock(),
            }

    def call_finished(self, *, role: str, step: dict) -> None:
        with self._lock:
            started = self._in_flight.pop(role, {}).get("startedAt", self._clock())
            usage = step.get("usage") or {}
            self._done.append(
                {
                    "role": role,
                    "label": step.get("role_label") or role,
                    "seconds": round(self._clock() - started, 1),
                    "costUsd": step.get("costUsd") or 0.0,
                    "outputTokens": usage.get("output", 0),
                    "error": bool(step.get("error")),
                }
            )

    def snapshot(self) -> dict:
        now = self._clock()
        with self._lock:
            in_flight = [
                {**{k: v for k, v in c.items() if k != "startedAt"}, "seconds": round(now - c["startedAt"], 1)}
                for c in self._in_flight.values()
            ]
            done = list(self._done)
            calls = self._calls
        return {
            "elapsedS": round(now - self._started, 1),
            "inFlight": in_flight,
            "done": done,
            "modelCalls": calls,
            "spentUsd": round(sum(d["costUsd"] for d in done), 6),
            "cancelled": self._cancelled,
        }
