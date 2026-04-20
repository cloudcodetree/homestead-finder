"""Tests for scraper/query_server.py handler and sanitization.

Exercises the request handler directly via a mock BaseHTTPRequestHandler
context — no actual sockets. Avoids pulling in a real network test.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import query_server


# ── _sanitize_matches ───────────────────────────────────────────────────────


def test_sanitize_matches_returns_empty_list_for_non_dict():
    assert query_server._sanitize_matches("nope", {"a"}, limit=5) == []
    assert query_server._sanitize_matches(None, {"a"}, limit=5) == []


def test_sanitize_matches_returns_empty_when_no_matches_key():
    assert query_server._sanitize_matches({"other": []}, {"a"}, limit=5) == []


def test_sanitize_matches_drops_unknown_ids():
    raw = {
        "matches": [
            {"id": "a", "reason": "r1"},
            {"id": "bogus", "reason": "r2"},
            {"id": "b", "reason": "r3"},
        ]
    }
    out = query_server._sanitize_matches(raw, {"a", "b"}, limit=10)
    assert [m["id"] for m in out] == ["a", "b"]


def test_sanitize_matches_dedupes():
    raw = {
        "matches": [
            {"id": "a", "reason": "r1"},
            {"id": "a", "reason": "r2"},
        ]
    }
    out = query_server._sanitize_matches(raw, {"a"}, limit=10)
    assert len(out) == 1


def test_sanitize_matches_respects_limit():
    raw = {"matches": [{"id": f"id{i}", "reason": "r"} for i in range(10)]}
    valid = {f"id{i}" for i in range(10)}
    out = query_server._sanitize_matches(raw, valid, limit=3)
    assert len(out) == 3


def test_sanitize_matches_truncates_long_reason():
    raw = {"matches": [{"id": "a", "reason": "x" * 1000}]}
    out = query_server._sanitize_matches(raw, {"a"}, limit=10)
    assert len(out[0]["reason"]) <= 400


def test_sanitize_matches_skips_non_string_ids():
    raw = {"matches": [{"id": 42, "reason": "r"}, {"id": "a", "reason": "r"}]}
    out = query_server._sanitize_matches(raw, {"a"}, limit=10)
    assert [m["id"] for m in out] == ["a"]


def test_sanitize_matches_skips_non_dict_entries():
    raw = {"matches": ["bad", {"id": "a", "reason": "r"}, None]}
    out = query_server._sanitize_matches(raw, {"a"}, limit=10)
    assert len(out) == 1


# ── Handler invocation via a fake request ───────────────────────────────────


class _FakeRequest:
    """Minimal fake of the socket-object BaseHTTPRequestHandler expects."""

    def __init__(self, raw: bytes):
        self.rfile = io.BytesIO(raw)
        self.wfile = io.BytesIO()

    def makefile(self, *args, **kwargs):
        return self.rfile


def _invoke(
    method: str,
    path: str,
    body: bytes = b"",
    headers: dict | None = None,
    listings_path: Path | None = None,
) -> tuple[int, dict]:
    """Construct a handler, invoke the method, and return (status, json body)."""
    headers = headers or {}
    lines = [f"{method} {path} HTTP/1.1"]
    for k, v in headers.items():
        lines.append(f"{k}: {v}")
    if body:
        lines.append(f"Content-Length: {len(body)}")
    raw_request = ("\r\n".join(lines) + "\r\n\r\n").encode() + body

    req = _FakeRequest(raw_request)

    # Configure handler class attrs before instantiation
    if listings_path is not None:
        query_server.QueryHandler.listings_path = listings_path

    # Instantiate without running serve; call the verb method manually
    handler = query_server.QueryHandler.__new__(query_server.QueryHandler)
    handler.rfile = req.rfile
    handler.wfile = req.wfile
    handler.client_address = ("127.0.0.1", 0)
    handler.server = None
    # Parse request line + headers
    handler.raw_requestline = req.rfile.readline()
    handler.parse_request()

    # Dispatch
    if method == "GET":
        handler.do_GET()
    elif method == "POST":
        handler.do_POST()
    elif method == "OPTIONS":
        handler.do_OPTIONS()

    # Read back the response
    response_bytes = handler.wfile.getvalue()
    # Split off headers from body
    head, _, body_bytes = response_bytes.partition(b"\r\n\r\n")
    status_line = head.split(b"\r\n", 1)[0].decode()
    status = int(status_line.split(" ")[1])
    try:
        body_json = json.loads(body_bytes) if body_bytes else {}
    except json.JSONDecodeError:
        body_json = {}
    return status, body_json


def test_health_endpoint_returns_ok_status(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    with patch.object(query_server, "is_available", return_value=True):
        status, body = _invoke("GET", "/health", listings_path=listings_file)
    assert status == 200
    assert body["ok"] is True
    assert body["claudeAvailable"] is True


def test_health_reports_claude_unavailable(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    with patch.object(query_server, "is_available", return_value=False):
        status, body = _invoke("GET", "/health", listings_path=listings_file)
    assert status == 200
    assert body["claudeAvailable"] is False


def test_unknown_get_returns_404(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    status, body = _invoke("GET", "/nope", listings_path=listings_file)
    assert status == 404


def test_post_to_non_query_returns_404(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    status, _ = _invoke(
        "POST", "/other", body=b'{"question":"x"}', listings_path=listings_file
    )
    assert status == 404


def test_post_without_body_returns_400(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    status, body = _invoke("POST", "/query", listings_path=listings_file)
    assert status == 400
    assert "missing_or_too_large" in body["error"]


def test_post_with_invalid_json_returns_400(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    status, body = _invoke(
        "POST", "/query", body=b"not json", listings_path=listings_file
    )
    assert status == 400
    assert body["error"] == "invalid_json"


def test_post_with_missing_question_returns_400(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    status, body = _invoke("POST", "/query", body=b"{}", listings_path=listings_file)
    assert status == 400
    assert body["error"] == "question_required"


def test_post_with_blank_question_returns_400(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    status, body = _invoke(
        "POST",
        "/query",
        body=b'{"question":"   "}',
        listings_path=listings_file,
    )
    assert status == 400
    assert body["error"] == "question_required"


def test_post_with_overlong_question_returns_400(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    big = "x" * 501
    status, body = _invoke(
        "POST",
        "/query",
        body=json.dumps({"question": big}).encode(),
        listings_path=listings_file,
    )
    assert status == 400
    assert body["error"] == "question_too_long"


def test_post_with_empty_listings_returns_empty_matches(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    status, body = _invoke(
        "POST",
        "/query",
        body=b'{"question":"anything"}',
        listings_path=listings_file,
    )
    assert status == 200
    assert body["matches"] == []


def test_post_calls_claude_and_returns_sanitized_matches(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text(
        json.dumps(
            [
                {"id": "a", "title": "A", "price": 100, "acreage": 10},
                {"id": "b", "title": "B", "price": 200, "acreage": 20},
            ]
        )
    )
    fake_response = {"matches": [{"id": "a", "reason": "great"}]}
    with patch.object(query_server, "call_json", return_value=fake_response):
        status, body = _invoke(
            "POST",
            "/query",
            body=b'{"question":"cheap land"}',
            listings_path=listings_file,
        )
    assert status == 200
    assert body["matches"] == [{"id": "a", "reason": "great"}]
    assert body["totalConsidered"] == 2


def test_post_drops_claude_matches_with_invalid_ids(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text(json.dumps([{"id": "a", "title": "A"}]))
    fake_response = {
        "matches": [
            {"id": "ghost", "reason": "hallucinated"},
            {"id": "a", "reason": "real"},
        ]
    }
    with patch.object(query_server, "call_json", return_value=fake_response):
        _, body = _invoke(
            "POST",
            "/query",
            body=b'{"question":"q"}',
            listings_path=listings_file,
        )
    assert [m["id"] for m in body["matches"]] == ["a"]


def test_post_returns_503_when_claude_unavailable(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text(json.dumps([{"id": "a"}]))
    with patch.object(
        query_server,
        "call_json",
        side_effect=query_server.LLMUnavailable("not logged in"),
    ):
        status, body = _invoke(
            "POST",
            "/query",
            body=b'{"question":"q"}',
            listings_path=listings_file,
        )
    assert status == 503
    assert "claude_unavailable" in body["error"]


def test_post_returns_502_when_claude_fails(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text(json.dumps([{"id": "a"}]))
    with patch.object(
        query_server,
        "call_json",
        side_effect=query_server.LLMCallFailed("bad output"),
    ):
        status, body = _invoke(
            "POST",
            "/query",
            body=b'{"question":"q"}',
            listings_path=listings_file,
        )
    assert status == 502
    assert "claude_failed" in body["error"]


def test_cors_origin_allowed_for_dev_port(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    # Allowed Vite origin should be echoed back in Access-Control-Allow-Origin
    req_bytes = (
        "GET /health HTTP/1.1\r\nOrigin: http://localhost:5173\r\n\r\n"
    ).encode()
    handler = query_server.QueryHandler.__new__(query_server.QueryHandler)
    handler.rfile = io.BytesIO(req_bytes)
    handler.wfile = io.BytesIO()
    handler.client_address = ("127.0.0.1", 0)
    handler.server = None
    query_server.QueryHandler.listings_path = listings_file
    handler.raw_requestline = handler.rfile.readline()
    handler.parse_request()
    with patch.object(query_server, "is_available", return_value=True):
        handler.do_GET()
    raw = handler.wfile.getvalue().decode()
    assert "Access-Control-Allow-Origin: http://localhost:5173" in raw


def test_cors_disallowed_origin_not_echoed(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    req_bytes = ("GET /health HTTP/1.1\r\nOrigin: http://evil.example\r\n\r\n").encode()
    handler = query_server.QueryHandler.__new__(query_server.QueryHandler)
    handler.rfile = io.BytesIO(req_bytes)
    handler.wfile = io.BytesIO()
    handler.client_address = ("127.0.0.1", 0)
    handler.server = None
    query_server.QueryHandler.listings_path = listings_file
    handler.raw_requestline = handler.rfile.readline()
    handler.parse_request()
    with patch.object(query_server, "is_available", return_value=True):
        handler.do_GET()
    raw = handler.wfile.getvalue().decode()
    assert "Access-Control-Allow-Origin: http://evil.example" not in raw


def test_options_returns_204_with_cors(tmp_path):
    listings_file = tmp_path / "listings.json"
    listings_file.write_text("[]")
    status, _ = _invoke(
        "OPTIONS",
        "/query",
        headers={"Origin": "http://localhost:5173"},
        listings_path=listings_file,
    )
    assert status == 204
