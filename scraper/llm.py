"""Thin wrapper around `claude -p` (headless Claude Code) as a local LLM call.

Intended for use on the developer's own machine where `claude login` has
already authenticated against a Claude Pro/Max/Team subscription, so calls
are billed against the subscription quota rather than API credits.

This is NOT suitable for running in CI — GitHub Actions has no OAuth session,
so calls there would fail (or require ANTHROPIC_API_KEY, which defeats the
point). Scripts that use this module should be invoked manually by the
developer (e.g. `python -m scraper.enrich`).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from typing import Any

import ai_costs
from config import DATA_DIR
from logger import get_logger

log = get_logger("llm")


CACHE_DIR = DATA_DIR / "cache" / "llm"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Default model — Haiku is the cheapest per-listing enrichment option and
# plenty capable for tag extraction. Override via `model=` kwarg.
DEFAULT_MODEL = "haiku"

# How long to wait for `claude` to respond before giving up. Enrichment
# prompts are small, so this is generous.
DEFAULT_TIMEOUT_SECONDS = 180

# Retry policy for subprocess-level failures (timeout, non-zero exit).
# Model-level errors (envelope error, non-JSON output) are NOT retried —
# retrying won't help if the CLI consistently returns bad output. Auth
# failures (LLMUnavailable) are also not retried.
DEFAULT_MAX_RETRIES = 2  # 3 attempts total
DEFAULT_BACKOFF_SECONDS = 2.0  # first wait; doubles each retry


class LLMUnavailable(RuntimeError):
    """Raised when the `claude` CLI is missing or not authenticated."""


class LLMCallFailed(RuntimeError):
    """Raised when the CLI returned an error or unparseable output."""


@dataclass
class LLMResponse:
    """Result of a Claude Code call."""

    text: str
    """The raw text content of the model's response."""

    cost_usd: float
    """Estimated cost in USD (zero if Max-subscription-billed — the CLI still
    reports it for informational purposes)."""

    cached: bool = False
    """True if this response came from the on-disk cache."""

    input_tokens: int = 0
    output_tokens: int = 0

    def parse_json(self) -> Any:
        """Decode `.text` as JSON. Strips ```json fences if present."""
        text = self.text.strip()
        if text.startswith("```"):
            # Strip triple-backtick fences, optionally with a lang tag
            lines = text.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            text = "\n".join(lines).strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise LLMCallFailed(
                f"response is not valid JSON: {e}\n---\n{self.text[:500]}"
            ) from e


def _claude_path() -> str:
    """Resolve the `claude` executable path, or raise LLMUnavailable."""
    override = os.environ.get("CLAUDE_CMD")
    if override and shutil.which(override):
        return override
    found = shutil.which("claude")
    if not found:
        raise LLMUnavailable(
            "`claude` CLI not found on PATH. Install Claude Code and run "
            "`claude login`, or set CLAUDE_CMD=/path/to/claude."
        )
    return found


def _cache_key(prompt: str, model: str, system: str | None) -> str:
    h = hashlib.sha256()
    h.update(model.encode())
    h.update(b"\n--\n")
    h.update((system or "").encode())
    h.update(b"\n--\n")
    h.update(prompt.encode())
    return h.hexdigest()


def _run_subprocess_with_retry(
    cmd: list[str],
    *,
    timeout: int,
    max_retries: int,
    backoff: float,
) -> subprocess.CompletedProcess:
    """Run `cmd` with retries on transient failures (timeout, non-zero exit).

    FileNotFoundError is NOT retried — it means the binary is missing.
    """
    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except FileNotFoundError as e:
            raise LLMUnavailable(f"failed to exec claude: {e}") from e
        except subprocess.TimeoutExpired as e:
            last_error = e
            if attempt < max_retries:
                delay = backoff * (2**attempt)
                log.info(
                    f"[llm] timeout on attempt {attempt + 1}/{max_retries + 1}, "
                    f"retrying in {delay:.1f}s"
                )
                time.sleep(delay)
                continue
            raise LLMCallFailed(
                f"claude -p timed out after {timeout}s ({max_retries + 1} attempts)"
            ) from e

        if proc.returncode == 0:
            return proc

        # Non-zero exit — retry if we have attempts left
        last_error = Exception(f"exit {proc.returncode}: {proc.stderr.strip()[:500]}")
        if attempt < max_retries:
            delay = backoff * (2**attempt)
            log.info(
                f"[llm] subprocess exited {proc.returncode} on attempt "
                f"{attempt + 1}/{max_retries + 1}, retrying in {delay:.1f}s"
            )
            time.sleep(delay)
            continue
        raise LLMCallFailed(
            f"claude -p exited {proc.returncode} after {max_retries + 1} "
            f"attempts: {proc.stderr.strip()[:500]}"
        )

    # Unreachable in practice, but satisfies the type checker
    raise LLMCallFailed(f"unexpected retry loop exit: {last_error}")


def call(
    prompt: str,
    *,
    model: str = DEFAULT_MODEL,
    system: str | None = None,
    use_cache: bool = True,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff: float = DEFAULT_BACKOFF_SECONDS,
    tag: str | None = None,
) -> LLMResponse:
    """Invoke `claude -p <prompt>` and return the response.

    Uses on-disk caching keyed by (model, system, prompt) hash so repeated
    calls with identical inputs are free. Delete files under `data/cache/llm/`
    to bust the cache.

    Subprocess-level failures (timeout, non-zero exit) are retried up to
    `max_retries` times with exponential backoff. Model-level failures
    (envelope error, non-JSON output) are NOT retried.

    `tag` is recorded in `data/ai_costs.jsonl` for cost attribution
    (e.g. "enrich", "curate", "query").
    """
    key = _cache_key(prompt, model, system)
    cache_file = CACHE_DIR / f"{key}.json"

    if use_cache and cache_file.exists():
        try:
            cached = json.loads(cache_file.read_text())
            resp = LLMResponse(
                text=cached["text"],
                cost_usd=0.0,
                cached=True,
                input_tokens=cached.get("input_tokens", 0),
                output_tokens=cached.get("output_tokens", 0),
            )
            ai_costs.record(
                model=cached.get("model", model),
                input_tokens=resp.input_tokens,
                output_tokens=resp.output_tokens,
                cost_usd=0.0,
                cached=True,
                tag=tag,
            )
            return resp
        except (json.JSONDecodeError, KeyError, OSError):
            # Corrupt cache entry — ignore and refetch
            pass

    claude = _claude_path()
    cmd = [claude, "-p", prompt, "--model", model, "--output-format", "json"]
    if system:
        cmd.extend(["--append-system-prompt", system])

    log.info(f"[llm] invoking claude -p ({model}, {len(prompt)} chars)")
    proc = _run_subprocess_with_retry(
        cmd, timeout=timeout, max_retries=max_retries, backoff=backoff
    )

    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise LLMCallFailed(
            f"claude -p output was not JSON: {e}\n---\n{proc.stdout[:500]}"
        ) from e

    if envelope.get("is_error") or envelope.get("subtype") != "success":
        raise LLMCallFailed(
            f"claude -p reported error: "
            f"subtype={envelope.get('subtype')} "
            f"result={str(envelope.get('result'))[:300]}"
        )

    text = envelope.get("result", "")
    if not isinstance(text, str):
        raise LLMCallFailed(f"unexpected result type: {type(text).__name__}")

    usage = envelope.get("usage", {}) or {}
    response = LLMResponse(
        text=text,
        cost_usd=float(envelope.get("total_cost_usd", 0.0) or 0.0),
        input_tokens=int(usage.get("input_tokens", 0) or 0),
        output_tokens=int(usage.get("output_tokens", 0) or 0),
    )

    ai_costs.record(
        model=model,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
        cost_usd=response.cost_usd,
        cached=False,
        tag=tag,
    )

    if use_cache:
        try:
            cache_file.write_text(
                json.dumps(
                    {
                        "text": response.text,
                        "input_tokens": response.input_tokens,
                        "output_tokens": response.output_tokens,
                        "model": model,
                    }
                )
            )
        except OSError as e:
            log.info(f"[llm] cache write failed: {e}")

    return response


def call_json(
    prompt: str,
    *,
    model: str = DEFAULT_MODEL,
    system: str | None = None,
    use_cache: bool = True,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
    tag: str | None = None,
) -> Any:
    """Convenience: call() then parse_json() the response. Raises LLMCallFailed
    if the model returns non-JSON."""
    resp = call(
        prompt,
        model=model,
        system=system,
        use_cache=use_cache,
        timeout=timeout,
        tag=tag,
    )
    return resp.parse_json()


def is_available() -> bool:
    """Cheap check — true if `claude` CLI is on PATH.

    Does not verify auth; a call may still fail at runtime if the user isn't
    logged in.
    """
    try:
        _claude_path()
        return True
    except LLMUnavailable:
        return False
