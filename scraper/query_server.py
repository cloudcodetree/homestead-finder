"""Local HTTP server that exposes Claude-powered natural-language queries
over listings.

Runs on the developer's own machine, using `claude -p` (Max subscription
quota). The React dev server (`npm run dev`) can call into this to re-rank
listings based on a free-form question.

Usage:
    python -m scraper.query_server                  # listens on 127.0.0.1:7799
    python -m scraper.query_server --port 8000
    python -m scraper.query_server --listings /custom/path.json

Endpoints:
    GET  /health                  — liveness check used by the frontend to
                                    decide whether to show the Ask-Claude bar
    POST /query                   — body: { question: str, limit?: int,
                                            model?: "haiku"|"sonnet"|"opus" }
                                    returns: { matches: [ { id, reason } ], ... }

This is a localhost-only tool intentionally — there is no auth. Do NOT
expose it to a public interface. The server refuses to bind to anything
except loopback unless --unsafe-any-host is passed.
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import config
from llm import LLMCallFailed, LLMUnavailable, call_json, is_available
from logger import get_logger

log = get_logger("query_server")


DEFAULT_PORT = 7799
DEFAULT_LIMIT = 25
DEFAULT_MODEL = "sonnet"

# CORS: allow Vite dev server (5173) and built preview (4173) to POST here.
# Keep the list short — this is strictly for local dev.
ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
}


def _compact_listing(item: dict[str, Any]) -> dict[str, Any]:
    """Trim a listing down to just the fields Claude needs to rank."""
    loc = item.get("location", {}) or {}
    return {
        "id": item.get("id"),
        "title": (item.get("title") or "")[:120],
        "price": item.get("price"),
        "acreage": item.get("acreage"),
        "pricePerAcre": item.get("pricePerAcre"),
        "state": loc.get("state", ""),
        "county": loc.get("county", ""),
        "dealScore": item.get("dealScore"),
        "homesteadFitScore": item.get("homesteadFitScore"),
        "aiTags": item.get("aiTags") or [],
        "redFlags": item.get("redFlags") or [],
        "aiSummary": item.get("aiSummary") or "",
        "features": item.get("features") or [],
    }


def _build_query_prompt(
    question: str, listings: list[dict[str, Any]], limit: int
) -> str:
    compact = [_compact_listing(item) for item in listings]
    payload = json.dumps(compact, indent=2)
    return f"""You are helping a user search a database of land listings using a natural-language question.

User's question:
{question}

Pick the listings that best match the question. Rank them from most to least relevant.
For each match, write a single-sentence reason explaining WHY this listing matches the
question — cite specific attributes. Don't fabricate attributes the listing doesn't have.

Return ONLY a JSON object shaped like this (no prose, no markdown):

{{
  "matches": [
    {{
      "id": "<listing id exactly as given>",
      "reason": "<one sentence grounded in the listing's actual attributes>"
    }},
    ...
  ]
}}

Rules:
- Return at most {limit} matches. If fewer than {limit} listings actually match,
  return only those that do — do NOT pad the list.
- Each id must match one in the candidate list.
- If NO listings match, return {{"matches": []}}.

CANDIDATES (JSON):
{payload}
"""


class QueryHandler(BaseHTTPRequestHandler):
    """Request handler for /health and /query."""

    # Injected by ServerContext before serve_forever()
    listings_path: Path = Path()
    default_limit: int = DEFAULT_LIMIT
    default_model: str = DEFAULT_MODEL

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        log.info(f"[query_server] {self.address_string()} - {format % args}")

    def _set_cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._set_cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "claudeAvailable": is_available(),
                    "model": self.default_model,
                },
            )
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/query":
            self._send_json(404, {"error": "not_found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 100_000:
            self._send_json(400, {"error": "missing_or_too_large_body"})
            return

        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "invalid_json"})
            return

        question = (body.get("question") or "").strip()
        if not question:
            self._send_json(400, {"error": "question_required"})
            return
        if len(question) > 500:
            self._send_json(400, {"error": "question_too_long"})
            return

        try:
            limit = int(body.get("limit") or self.default_limit)
        except (TypeError, ValueError):
            limit = self.default_limit
        limit = max(1, min(limit, 50))

        model = body.get("model") or self.default_model
        if model not in {"haiku", "sonnet", "opus"}:
            model = self.default_model

        # Reload listings on each call so the user can re-run scrapers in
        # another terminal without restarting the server.
        try:
            listings = json.loads(self.listings_path.read_text())
        except (OSError, json.JSONDecodeError) as e:
            self._send_json(500, {"error": f"listings_unavailable: {e}"})
            return

        if not isinstance(listings, list):
            self._send_json(500, {"error": "listings_not_an_array"})
            return

        if not listings:
            self._send_json(200, {"matches": [], "note": "no listings loaded"})
            return

        prompt = _build_query_prompt(question, listings, limit)
        log.info(
            f"[query_server] /query q={question[:60]!r} "
            f"listings={len(listings)} limit={limit} model={model}"
        )
        try:
            raw = call_json(prompt, model=model)
        except LLMUnavailable as e:
            self._send_json(503, {"error": f"claude_unavailable: {e}"})
            return
        except LLMCallFailed as e:
            self._send_json(502, {"error": f"claude_failed: {e}"})
            return

        valid_ids = {item.get("id") for item in listings}
        matches = _sanitize_matches(raw, valid_ids, limit)
        self._send_json(
            200,
            {
                "question": question,
                "model": model,
                "matches": matches,
                "totalConsidered": len(listings),
            },
        )


def _sanitize_matches(
    raw: Any, valid_ids: set[Any], limit: int
) -> list[dict[str, Any]]:
    if not isinstance(raw, dict):
        return []
    matches = raw.get("matches")
    if not isinstance(matches, list):
        return []

    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in matches:
        if not isinstance(m, dict):
            continue
        mid = m.get("id")
        if not isinstance(mid, str) or mid not in valid_ids or mid in seen:
            continue
        seen.add(mid)
        cleaned.append({"id": mid, "reason": str(m.get("reason", ""))[:400]})
        if len(cleaned) >= limit:
            break
    return cleaned


def run_server(
    host: str, port: int, listings_path: Path, model: str, limit: int
) -> None:
    if not listings_path.exists():
        print(f"error: listings file not found: {listings_path}", file=sys.stderr)
        raise SystemExit(2)

    # Attach config to the handler class before serving
    QueryHandler.listings_path = listings_path
    QueryHandler.default_model = model
    QueryHandler.default_limit = limit

    httpd = ThreadingHTTPServer((host, port), QueryHandler)
    ready = "ready" if is_available() else "Claude CLI NOT available"
    print(
        f"[query_server] listening on http://{host}:{port} — {ready}\n"
        f"[query_server] listings: {listings_path}\n"
        f"[query_server] default model: {model}\n"
        f"[query_server] Ctrl-C to stop"
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[query_server] stopping")
        httpd.shutdown()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Local HTTP proxy to Claude for natural-language listing queries."
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Interface to bind to (default: 127.0.0.1). Use --unsafe-any-host to bind 0.0.0.0.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--listings",
        type=Path,
        default=config.DATA_DIR / "listings.json",
        help="Path to listings JSON (default: data/listings.json)",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Default model for queries (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Default max matches per query (default: {DEFAULT_LIMIT})",
    )
    parser.add_argument(
        "--unsafe-any-host",
        action="store_true",
        help="Allow binding to non-loopback addresses. Only enable if you "
        "know what you're doing — this endpoint has no auth.",
    )
    args = parser.parse_args()

    host = args.host
    if host not in {"127.0.0.1", "localhost", "::1"} and not args.unsafe_any_host:
        print(
            f"error: refusing to bind to {host!r} without --unsafe-any-host",
            file=sys.stderr,
        )
        return 2

    run_server(host, args.port, args.listings, args.model, args.limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
