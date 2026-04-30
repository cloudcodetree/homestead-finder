"""Shared politeness layer for every outbound scrape request.

Sits underneath the strategy chain so every http / curl_cffi / browser
fetch respects the same rules regardless of which source module
initiated it. Five guarantees:

  1. **Per-domain token bucket.** Two scrapers hitting the same host
     (e.g. several Land.com sister sites) share one request clock, so
     concurrent scrapers don't bypass the rate limit by accident. Uses
     `time.monotonic()` so it's immune to wall-clock jumps.

  2. **robots.txt compliance.** On first hit of a domain we fetch
     `/robots.txt`, cache it for 24h, and refuse disallowed paths.
     Honors `User-agent: *` and `Crawl-delay:` directives — if the
     site requests 10s between requests, we use 10s (even if our own
     default is 2s).

  3. **429 / 503 exponential backoff.** When a site signals overload
     we back off 5s → 30s → 120s (up to 3 retries). Honors the
     `Retry-After` header if present.

  4. **Per-day request ceiling.** `MAX_REQUESTS_PER_DOMAIN_PER_DAY`
     (default 500) persisted to `data/scrape_quota.json`. Prevents
     accidental hammering if `--max-pages=200` gets passed.

  5. **Graceful degradation.** Every guard fails OPEN with a warning —
     robots.txt unreachable, quota file unwritable, etc. don't halt
     scraping. The goal is to be a good citizen, not a brittle one.

Import from scraper source modules / strategies as:

    from throttle import acquire, release, can_fetch

    throttle.acquire(url)        # blocks until we're allowed to request
    resp = do_http_thing(url)
    throttle.release(url, resp)  # records outcome for backoff/quota

Use `can_fetch(url)` if you need to check before constructing a
request (e.g. building a page-URL list).
"""

from __future__ import annotations

import json
import random
import threading
import time
import urllib.parse
import urllib.request
import urllib.robotparser
from dataclasses import dataclass, field
from pathlib import Path

from logger import get_logger

log = get_logger("scraper.throttle")

# ── Defaults (env-overridable via config) ───────────────────────────
import os

_DEFAULT_CRAWL_DELAY = float(os.getenv("THROTTLE_DEFAULT_DELAY", "2.0"))
_DEFAULT_MAX_PER_DAY = int(os.getenv("THROTTLE_MAX_PER_DAY", "500"))
_ROBOTS_TTL_SECONDS = 24 * 3600
_BACKOFF_STEPS = (5.0, 30.0, 120.0)
_USER_AGENT_TOKEN = "homestead-finder"

# Quota file lives next to listings.json so the same data dir holds
# all per-run persistent state.
try:
    from config import DATA_DIR

    _QUOTA_FILE: Path = DATA_DIR / "scrape_quota.json"
except Exception:  # noqa: BLE001
    _QUOTA_FILE = Path(__file__).parent.parent / "data" / "scrape_quota.json"


class RobotsDisallowed(Exception):
    """Raised when robots.txt forbids the requested path."""


class DailyQuotaExceeded(Exception):
    """Raised when a domain has hit its daily request ceiling."""


# ── Per-domain runtime state ────────────────────────────────────────


@dataclass
class _DomainState:
    """Everything we track per origin."""

    # `None` = never fetched; distinguishes first-acquire (no sleep
    # needed) from "acquired 0.0s after the monotonic epoch" which
    # would otherwise force a full crawl-delay on every cold start.
    last_request: float | None = None
    crawl_delay: float = _DEFAULT_CRAWL_DELAY
    robots: urllib.robotparser.RobotFileParser | None = None
    robots_fetched_at: float = 0.0
    consecutive_failures: int = 0
    backoff_until: float = 0.0
    # Populated lazily from the quota file on first touch each day.
    day: str = ""
    count_today: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)


_DOMAINS: dict[str, _DomainState] = {}
_REGISTRY_LOCK = threading.Lock()
_QUOTA_LOCK = threading.Lock()


def _origin(url: str) -> str:
    """Return the origin-level key we throttle on: scheme://host."""
    p = urllib.parse.urlsplit(url)
    host = (p.hostname or "").lower()
    return host


def _state_for(url: str) -> _DomainState:
    host = _origin(url)
    with _REGISTRY_LOCK:
        state = _DOMAINS.get(host)
        if state is None:
            state = _DomainState()
            _DOMAINS[host] = state
        return state


# ── robots.txt ──────────────────────────────────────────────────────


def _ensure_robots(url: str, state: _DomainState) -> None:
    """Fetch + cache robots.txt if stale. Fails open on any error."""
    now = time.monotonic()
    if state.robots and (now - state.robots_fetched_at) < _ROBOTS_TTL_SECONDS:
        return
    p = urllib.parse.urlsplit(url)
    robots_url = urllib.parse.urlunsplit((p.scheme, p.netloc, "/robots.txt", "", ""))
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(robots_url)
    try:
        req = urllib.request.Request(
            robots_url,
            headers={"User-Agent": f"{_USER_AGENT_TOKEN}/1.0"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            text = r.read().decode("utf-8", errors="replace")
        rp.parse(text.splitlines())
        state.robots = rp
        state.robots_fetched_at = now
        # Honor Crawl-delay if present and stricter than our default.
        cd = rp.crawl_delay(_USER_AGENT_TOKEN) or rp.crawl_delay("*")
        if cd and float(cd) > state.crawl_delay:
            log.info(
                f"[throttle] {p.hostname}: honoring robots Crawl-delay={cd}s "
                f"(was {state.crawl_delay}s)"
            )
            state.crawl_delay = float(cd)
    except Exception as e:  # noqa: BLE001
        # Fail open. Record a sentinel so we don't re-try the robots
        # fetch every single request if the file is missing.
        #
        # Subtle: an UNPARSED RobotFileParser returns False from
        # can_fetch (it has neither rules nor a default-allow flag).
        # Without forcing allow_all here, every request to a domain
        # whose robots.txt 403s (Akamai et al.) gets silently
        # disallowed. LandWatch hit exactly this on the TX pivot.
        log.info(f"[throttle] robots.txt unreachable for {p.hostname}: {e}")
        rp.allow_all = True
        state.robots = rp
        state.robots_fetched_at = now


def can_fetch(url: str) -> bool:
    """True iff robots.txt allows `_USER_AGENT_TOKEN` at this URL.
    Cheap, doesn't block — use this to filter a URL list before
    enqueueing. Fails open on robots errors."""
    state = _state_for(url)
    with state.lock:
        _ensure_robots(url, state)
        if state.robots is None:
            return True
        try:
            return state.robots.can_fetch(_USER_AGENT_TOKEN, url) or state.robots.can_fetch("*", url)
        except Exception:  # noqa: BLE001
            return True


# ── Daily quota (persisted) ─────────────────────────────────────────


def _today_key() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def _load_quota() -> dict[str, dict[str, int | str]]:
    with _QUOTA_LOCK:
        if not _QUOTA_FILE.exists():
            return {}
        try:
            raw = json.loads(_QUOTA_FILE.read_text())
            if isinstance(raw, dict):
                return raw
        except (OSError, json.JSONDecodeError):
            pass
        return {}


def _save_quota(snapshot: dict[str, dict[str, int | str]]) -> None:
    with _QUOTA_LOCK:
        try:
            _QUOTA_FILE.parent.mkdir(parents=True, exist_ok=True)
            _QUOTA_FILE.write_text(json.dumps(snapshot, indent=2, sort_keys=True))
        except OSError as e:
            log.info(f"[throttle] could not persist quota: {e}")


def _sync_quota_for(host: str, state: _DomainState) -> None:
    """Load today's counter from disk into memory (once per host/day)."""
    today = _today_key()
    if state.day == today:
        return
    snap = _load_quota()
    host_row = snap.get(host, {})
    if host_row.get("day") == today:
        state.count_today = int(host_row.get("count", 0))
    else:
        state.count_today = 0
    state.day = today


def _flush_quota_for(host: str, state: _DomainState) -> None:
    """Write this host's in-memory counter back to disk."""
    snap = _load_quota()
    snap[host] = {"day": state.day, "count": state.count_today}
    _save_quota(snap)


# ── acquire / release ───────────────────────────────────────────────


def acquire(url: str, *, strict_robots: bool = True) -> None:
    """Block until we're allowed to hit `url`. Raises RobotsDisallowed
    or DailyQuotaExceeded on permanent denial; returns after any
    required wait on transient backoff.
    """
    state = _state_for(url)
    host = _origin(url)
    with state.lock:
        _ensure_robots(url, state)
        if strict_robots and state.robots is not None:
            try:
                allowed = state.robots.can_fetch(
                    _USER_AGENT_TOKEN, url
                ) or state.robots.can_fetch("*", url)
            except Exception:  # noqa: BLE001
                allowed = True
            if not allowed:
                raise RobotsDisallowed(f"robots.txt disallows {url}")

        _sync_quota_for(host, state)
        if state.count_today >= _DEFAULT_MAX_PER_DAY:
            raise DailyQuotaExceeded(
                f"{host}: {state.count_today}/{_DEFAULT_MAX_PER_DAY} requests today"
            )

        # Exponential backoff wait (if we're in a 429/503 cooldown)
        now = time.monotonic()
        if state.backoff_until > now:
            wait = state.backoff_until - now
            log.info(f"[throttle] {host}: backoff wait {wait:.1f}s")
            time.sleep(wait)

        # Honor the per-domain Crawl-delay + jitter (skip on first hit)
        if state.last_request is not None:
            elapsed = time.monotonic() - state.last_request
            delay = state.crawl_delay + random.uniform(0.1, 0.5)
            if elapsed < delay:
                time.sleep(delay - elapsed)

        state.last_request = time.monotonic()
        state.count_today += 1
        _flush_quota_for(host, state)


def release(url: str, status_code: int | None, *, retry_after: float | None = None) -> None:
    """Feed the fetch outcome back so we can trip backoff on overload.

    Call this after every attempt (success OR failure). `status_code`
    None means a connection-level error; treat like 503 for backoff.
    """
    state = _state_for(url)
    host = _origin(url)
    with state.lock:
        if status_code in (429, 503) or status_code is None:
            state.consecutive_failures = min(
                state.consecutive_failures + 1, len(_BACKOFF_STEPS)
            )
            step = _BACKOFF_STEPS[state.consecutive_failures - 1]
            # Prefer server-provided Retry-After when it's longer than
            # our exponential step — servers know best.
            wait = max(step, retry_after or 0.0)
            state.backoff_until = time.monotonic() + wait
            log.info(
                f"[throttle] {host}: status={status_code} → back off {wait:.0f}s "
                f"(consecutive={state.consecutive_failures})"
            )
        elif status_code and status_code < 400:
            # Success or redirect — clear the failure streak.
            state.consecutive_failures = 0
            state.backoff_until = 0.0
        # 4xx other than 429 isn't a signal to back off — the caller
        # fucked up the URL, not the site asking us to slow down.


# ── Testing helpers ─────────────────────────────────────────────────


def _reset_for_tests() -> None:
    """Test-only: wipe all per-domain state."""
    with _REGISTRY_LOCK:
        _DOMAINS.clear()


def set_quota_file(path: Path) -> None:
    """Test-only: point the persistence file elsewhere."""
    global _QUOTA_FILE
    _QUOTA_FILE = path


def get_state(url: str) -> _DomainState:
    """Test-only: expose a host's state dataclass."""
    return _state_for(url)
