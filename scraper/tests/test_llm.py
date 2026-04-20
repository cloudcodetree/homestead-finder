"""Tests for the `claude -p` subprocess wrapper in scraper/llm.py.

The real subprocess is mocked — these tests verify orchestration (cache
hits, envelope parsing, error classification, prompt hashing) without ever
launching `claude`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure scraper root is on path
sys.path.insert(0, str(Path(__file__).parent.parent))

import llm


@pytest.fixture
def tmp_cache(monkeypatch, tmp_path):
    """Redirect the on-disk cache to a pytest tmp_path so tests don't pollute data/."""
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path)
    return tmp_path


def _fake_envelope(result_text: str) -> str:
    """Build a fake stdout string shaped like `claude -p --output-format json` output."""
    return json.dumps(
        {
            "type": "result",
            "subtype": "success",
            "is_error": False,
            "result": result_text,
            "total_cost_usd": 0.001,
            "usage": {"input_tokens": 100, "output_tokens": 50},
        }
    )


def _mock_completed(stdout: str, returncode: int = 0, stderr: str = "") -> MagicMock:
    mock = MagicMock()
    mock.stdout = stdout
    mock.stderr = stderr
    mock.returncode = returncode
    return mock


# ── LLMResponse.parse_json ──────────────────────────────────────────────────


def test_parse_json_handles_plain_json():
    resp = llm.LLMResponse(text='{"ok": true}', cost_usd=0)
    assert resp.parse_json() == {"ok": True}


def test_parse_json_strips_markdown_fence():
    resp = llm.LLMResponse(text='```json\n{"ok": true}\n```', cost_usd=0)
    assert resp.parse_json() == {"ok": True}


def test_parse_json_strips_bare_triple_backtick():
    resp = llm.LLMResponse(text='```\n{"ok": true}\n```', cost_usd=0)
    assert resp.parse_json() == {"ok": True}


def test_parse_json_raises_on_non_json():
    resp = llm.LLMResponse(text="not json at all", cost_usd=0)
    with pytest.raises(llm.LLMCallFailed):
        resp.parse_json()


# ── call() happy path and caching ───────────────────────────────────────────


def test_call_returns_response_and_writes_cache(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed(_fake_envelope("hello"))
        ) as run,
    ):
        resp = llm.call("my prompt", model="haiku")

    assert resp.text == "hello"
    assert resp.cost_usd == 0.001
    assert resp.input_tokens == 100
    assert resp.output_tokens == 50
    assert not resp.cached
    run.assert_called_once()

    # Cache file should now exist
    cache_files = list(tmp_cache.glob("*.json"))
    assert len(cache_files) == 1


def test_call_hits_cache_on_second_identical_call(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed(_fake_envelope("hi"))
        ) as run,
    ):
        llm.call("same prompt", model="haiku")
        resp2 = llm.call("same prompt", model="haiku")

    # Only the first call should have invoked the subprocess
    assert run.call_count == 1
    assert resp2.cached is True
    assert resp2.text == "hi"


def test_call_cache_key_differs_by_model(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed(_fake_envelope("x"))
        ) as run,
    ):
        llm.call("same prompt", model="haiku")
        llm.call("same prompt", model="sonnet")

    assert run.call_count == 2


def test_call_cache_key_differs_by_system(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed(_fake_envelope("x"))
        ) as run,
    ):
        llm.call("same prompt", system="sys-A")
        llm.call("same prompt", system="sys-B")

    assert run.call_count == 2


def test_call_system_prompt_is_passed_via_append_flag(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed(_fake_envelope("x"))
        ) as run,
    ):
        llm.call("q", system="be brief")

    cmd = run.call_args[0][0]
    assert "--append-system-prompt" in cmd
    assert cmd[cmd.index("--append-system-prompt") + 1] == "be brief"


def test_call_use_cache_false_bypasses_and_still_stores(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed(_fake_envelope("x"))
        ) as run,
    ):
        # First call (cached)
        llm.call("p")
        # Second call with use_cache=False — must re-hit subprocess
        llm.call("p", use_cache=False)

    assert run.call_count == 2


# ── Error paths ─────────────────────────────────────────────────────────────


def test_call_raises_unavailable_when_binary_missing(tmp_cache, monkeypatch):
    monkeypatch.setenv("CLAUDE_CMD", "")
    with patch.object(llm.shutil, "which", return_value=None):
        with pytest.raises(llm.LLMUnavailable):
            llm.call("x")


def test_call_raises_when_subprocess_nonzero(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess,
            "run",
            return_value=_mock_completed("", returncode=1, stderr="boom"),
        ),
    ):
        with pytest.raises(llm.LLMCallFailed, match="exited 1"):
            llm.call("x")


def test_call_raises_when_stdout_not_json(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed("not-json-at-all")
        ),
    ):
        with pytest.raises(llm.LLMCallFailed, match="not JSON"):
            llm.call("x")


def test_call_raises_when_envelope_is_error(tmp_cache):
    envelope = json.dumps(
        {"subtype": "error", "is_error": True, "result": "something broke"}
    )
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(llm.subprocess, "run", return_value=_mock_completed(envelope)),
    ):
        with pytest.raises(llm.LLMCallFailed, match="reported error"):
            llm.call("x")


def test_call_raises_on_timeout(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess,
            "run",
            side_effect=llm.subprocess.TimeoutExpired(cmd="claude", timeout=1),
        ),
    ):
        with pytest.raises(llm.LLMCallFailed, match="timed out"):
            llm.call("x", timeout=1)


def test_call_json_raises_when_result_is_not_json(tmp_cache):
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess,
            "run",
            return_value=_mock_completed(_fake_envelope("plain text")),
        ),
    ):
        with pytest.raises(llm.LLMCallFailed, match="not valid JSON"):
            llm.call_json("x")


def test_corrupt_cache_entry_is_ignored_and_refetched(tmp_cache):
    # Plant a corrupt cache entry under the hash that would be used
    key = llm._cache_key("prompt", "haiku", None)
    (tmp_cache / f"{key}.json").write_text("this is not json")

    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed(_fake_envelope("fresh"))
        ) as run,
    ):
        resp = llm.call("prompt", model="haiku")

    assert resp.text == "fresh"
    assert resp.cached is False
    run.assert_called_once()


# ── Retry logic ─────────────────────────────────────────────────────────────


def test_call_retries_timeout_then_succeeds(tmp_cache, monkeypatch):
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)  # don't actually wait
    # Timeout on first call, success on second
    responses = [
        llm.subprocess.TimeoutExpired(cmd="claude", timeout=1),
        _mock_completed(_fake_envelope("recovered")),
    ]

    def _side_effect(*args, **kwargs):
        r = responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(llm.subprocess, "run", side_effect=_side_effect) as run,
    ):
        resp = llm.call("x", max_retries=2, backoff=0)

    assert run.call_count == 2
    assert resp.text == "recovered"


def test_call_retries_exit_nonzero_then_succeeds(tmp_cache, monkeypatch):
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    responses = [
        _mock_completed("", returncode=1, stderr="transient"),
        _mock_completed(_fake_envelope("recovered")),
    ]
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(llm.subprocess, "run", side_effect=responses) as run,
    ):
        resp = llm.call("x", max_retries=2, backoff=0)

    assert run.call_count == 2
    assert resp.text == "recovered"


def test_call_gives_up_after_max_retries_on_timeout(tmp_cache, monkeypatch):
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess,
            "run",
            side_effect=llm.subprocess.TimeoutExpired(cmd="claude", timeout=1),
        ) as run,
    ):
        with pytest.raises(llm.LLMCallFailed, match="3 attempts"):
            llm.call("x", max_retries=2, backoff=0)
    assert run.call_count == 3  # initial + 2 retries


def test_call_does_not_retry_parse_errors(tmp_cache, monkeypatch):
    """Bad JSON output is deterministic — retrying won't help."""
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed("not-json")
        ) as run,
    ):
        with pytest.raises(llm.LLMCallFailed, match="not JSON"):
            llm.call("x", max_retries=5, backoff=0)
    # Only one subprocess call — parse failures aren't retried
    assert run.call_count == 1


def test_call_does_not_retry_envelope_errors(tmp_cache, monkeypatch):
    """Model-reported errors are not transient — don't retry."""
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    envelope = json.dumps({"subtype": "error", "is_error": True, "result": "bad"})
    with (
        patch.object(llm, "_claude_path", return_value="/fake/claude"),
        patch.object(
            llm.subprocess, "run", return_value=_mock_completed(envelope)
        ) as run,
    ):
        with pytest.raises(llm.LLMCallFailed, match="reported error"):
            llm.call("x", max_retries=5, backoff=0)
    assert run.call_count == 1


# ── is_available ────────────────────────────────────────────────────────────


def test_is_available_true_when_binary_found():
    with patch.object(llm, "_claude_path", return_value="/fake/claude"):
        assert llm.is_available() is True


def test_is_available_false_when_missing():
    with patch.object(llm, "_claude_path", side_effect=llm.LLMUnavailable("nope")):
        assert llm.is_available() is False
