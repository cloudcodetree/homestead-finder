"""Shared HTTP helper for government-API calls.

Keeps timeouts, retries, and User-Agent policy in one place. Government
GIS services are often overloaded and return 504/503 transiently — a
small retry loop makes the enrichment pipeline robust.
"""

from __future__ import annotations

import json
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from logger import get_logger

log = get_logger("enrichment.http")

USER_AGENT = "HomesteadFinder/1.0 (https://github.com/cloudcodetree/homestead-finder)"

DEFAULT_TIMEOUT = 20
DEFAULT_MAX_RETRIES = 2
DEFAULT_BACKOFF_SECONDS = 2.0


class HttpError(RuntimeError):
    """Raised after all retries are exhausted on a non-2xx response."""


def get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: int = DEFAULT_TIMEOUT,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff: float = DEFAULT_BACKOFF_SECONDS,
) -> Any:
    """GET a URL (with optional query params) and parse JSON.

    Retries on any transient HTTP/URL error with exponential backoff.
    Raises HttpError if all attempts fail.
    """
    if params:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}{urlencode(params)}"
    last_err: Exception | None = None
    for attempt in range(max_retries + 1):
        req = Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except Exception as e:
            last_err = e
            if attempt < max_retries:
                delay = backoff * (2**attempt)
                log.info(
                    f"[http] {url[:80]}… attempt {attempt + 1} failed "
                    f"({type(e).__name__}: {e}); retrying in {delay:.1f}s"
                )
                time.sleep(delay)
                continue
            raise HttpError(
                f"GET {url} failed after {max_retries + 1} attempts: "
                f"{type(e).__name__}: {e}"
            ) from e
    raise HttpError(f"unreachable; last error: {last_err}")


def post_json(
    url: str,
    payload: dict[str, Any],
    *,
    timeout: int = DEFAULT_TIMEOUT,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff: float = DEFAULT_BACKOFF_SECONDS,
) -> Any:
    """POST a JSON payload and parse the JSON response. Same retry policy as GET."""
    body = json.dumps(payload).encode()
    last_err: Exception | None = None
    for attempt in range(max_retries + 1):
        req = Request(
            url,
            data=body,
            headers={
                "User-Agent": USER_AGENT,
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except Exception as e:
            last_err = e
            if attempt < max_retries:
                delay = backoff * (2**attempt)
                log.info(
                    f"[http] POST {url[:80]}… attempt {attempt + 1} failed "
                    f"({type(e).__name__}: {e}); retrying in {delay:.1f}s"
                )
                time.sleep(delay)
                continue
            raise HttpError(
                f"POST {url} failed after {max_retries + 1} attempts: "
                f"{type(e).__name__}: {e}"
            ) from e
    raise HttpError(f"unreachable; last error: {last_err}")
