#!/usr/bin/env python3
"""IQVault Comics API — serves Comics Terminal from PostgreSQL."""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import psycopg2
import psycopg2.extras

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from comics_db import fetch_inventory, update_holding  # noqa: E402

PORT = int(os.environ.get("COMICS_API_PORT", "5200"))
DEFAULT_DSN = "dbname=iqvault user=postgres password=vault host=localhost"
DSN = os.environ.get("IQVAULT_DATABASE_DSN") or os.environ.get("DATABASE_URL") or DEFAULT_DSN


def json_response(handler: BaseHTTPRequestHandler, status: int, body: dict | list) -> None:
    data = json.dumps(body, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", 0))
    raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
    return json.loads(raw) if raw.strip() else {}


class ComicsHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/api/comics/health":
            try:
                conn = psycopg2.connect(DSN)
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM vault_collection.holding")
                count = cur.fetchone()[0]
                cur.close()
                conn.close()
                json_response(self, 200, {"ok": True, "holdings": count, "source": "postgres"})
            except Exception as e:
                json_response(self, 503, {"ok": False, "error": str(e)})
            return

        if path not in ("/api/comics/meta", "/api/comics/inventory"):
            json_response(self, 404, {"error": "Not found"})
            return

        try:
            conn = psycopg2.connect(DSN)
            psycopg2.extras.register_default_jsonb(conn)
            rows, meta = fetch_inventory(conn)
            conn.close()
        except Exception as e:
            json_response(self, 503, {"ok": False, "error": str(e)})
            return

        if path == "/api/comics/meta":
            json_response(self, 200, meta)
        else:
            json_response(self, 200, rows)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/comics/holding/"):
            self._handle_holding_patch(path)
            return
        json_response(self, 404, {"error": "Not found"})

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/comics/holding/"):
            self._handle_holding_patch(path)
            return
        json_response(self, 404, {"error": "Not found"})

    def _handle_holding_patch(self, path: str) -> None:
        holding_id = path.rsplit("/", 1)[-1]
        if not holding_id:
            json_response(self, 400, {"error": "Missing holding id"})
            return

        try:
            body = read_json(self)
            fields = body.get("fields") if isinstance(body.get("fields"), dict) else body
            conn = psycopg2.connect(DSN)
            psycopg2.extras.register_default_jsonb(conn)
            updated = update_holding(conn, holding_id, fields)
            conn.close()
            json_response(self, 200, {"ok": True, "row": updated})
        except LookupError as e:
            json_response(self, 404, {"error": str(e)})
        except ValueError as e:
            json_response(self, 400, {"error": str(e)})
        except Exception as e:
            json_response(self, 500, {"error": str(e)})


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), ComicsHandler)
    print(f"IQVault Comics API on http://127.0.0.1:{PORT}")
    print(f"  GET /api/comics/health")
    print(f"  GET /api/comics/meta")
    print(f"  GET   /api/comics/inventory")
    print(f"  POST  /api/comics/holding/{{id}}")
    print(f"  DSN: {DSN.split('password=')[0]}password=***")
    server.serve_forever()


if __name__ == "__main__":
    main()
