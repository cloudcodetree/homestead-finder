"""Preserve raw scraper output to disk so future parser changes can be
replayed without hitting the live site again.

Why: today's scrapers fetch + parse in one pass and discard the raw
response. If we later realize the parser missed a field, or want to
add a new enrichment that depends on raw HTML markup, we have to
re-scrape — which is slow, rate-limited, and the largest
blacklist-risk vector for the whole project.

Storing raw responses to `data/raw/{source}/{date}/{listing_id}.{ext}.gz`
costs cents in disk and decouples parser changes from live fetches.
Files are gzip-compressed on write (~70-80% size reduction on HTML).

This module is opt-in for now — sources call `archive(...)` after
their fetch step. We don't auto-instrument fetch_page() because some
sources (Craigslist sapi) batch many listings per call and the
archive-key would need to be the post_id, which the dispatcher
doesn't know about. Per-source explicit calls keep semantics clean.

Storage:
  data/raw/{source}/{YYYY-MM-DD}/{listing_id}.{ext}.gz

Read-back: `read(source, date, listing_id, ext)` returns the
decompressed bytes/string. Used by replay tooling (not yet built).

`data/raw/` is .gitignored — it grows ~10-50 MB per scrape day for
our current source set. A monthly snapshot to S3 covers offsite
backup if we ever need it; for now local + Time Machine is enough.
"""

from __future__ import annotations

import gzip
from datetime import date
from pathlib import Path

import config

# Root for archived raw responses. Lives under data/ alongside
# everything else, but is .gitignored so it doesn't bloat the repo.
RAW_DIR = config.DATA_DIR / "raw"

_VALID_EXTS = ("html", "json", "xml", "md", "txt")


def archive(
    source: str,
    listing_id: str,
    content: str | bytes,
    *,
    ext: str = "html",
    when: date | None = None,
) -> Path | None:
    """Persist `content` under data/raw/{source}/{date}/{listing_id}.{ext}.gz.

    Returns the written path on success, None on failure (we never
    raise — preservation is best-effort, scraping should continue
    even if disk is full).

    `listing_id` is sanitized to filename-safe characters; pathological
    ids fall back to a hash. `source` and `ext` are tightly validated.
    """
    if ext not in _VALID_EXTS:
        return None
    safe_source = "".join(c for c in source if c.isalnum() or c in "_-")
    if not safe_source:
        return None
    safe_id = "".join(c for c in str(listing_id) if c.isalnum() or c in "_-")
    if not safe_id:
        # Pathological id — hash to a stable filename
        import hashlib

        safe_id = hashlib.sha1(str(listing_id).encode()).hexdigest()[:16]

    day = (when or date.today()).isoformat()
    target_dir = RAW_DIR / safe_source / day
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    target = target_dir / f"{safe_id}.{ext}.gz"

    payload = content.encode("utf-8") if isinstance(content, str) else content
    try:
        with gzip.open(target, "wb", compresslevel=6) as f:
            f.write(payload)
    except OSError:
        return None
    return target


def read(
    source: str,
    when: date | str,
    listing_id: str,
    *,
    ext: str = "html",
) -> bytes | None:
    """Return the decompressed raw content for one archived row, or
    None if missing. Tooling-only — not used by the scrapers."""
    if ext not in _VALID_EXTS:
        return None
    day = when.isoformat() if isinstance(when, date) else str(when)
    safe_source = "".join(c for c in source if c.isalnum() or c in "_-")
    safe_id = "".join(c for c in str(listing_id) if c.isalnum() or c in "_-")
    target = RAW_DIR / safe_source / day / f"{safe_id}.{ext}.gz"
    if not target.exists():
        return None
    try:
        with gzip.open(target, "rb") as f:
            return f.read()
    except OSError:
        return None


def list_archived(source: str, when: date | str) -> list[str]:
    """List the listing_ids archived for a (source, day). Tooling-only."""
    day = when.isoformat() if isinstance(when, date) else str(when)
    safe_source = "".join(c for c in source if c.isalnum() or c in "_-")
    target_dir = RAW_DIR / safe_source / day
    if not target_dir.exists():
        return []
    out: list[str] = []
    for f in target_dir.iterdir():
        # Filenames look like "<id>.<ext>.gz"; the listing_id is
        # everything before the first dot.
        name = f.name
        out.append(name.split(".", 1)[0])
    return sorted(set(out))
