"""PLSS → lat/lng lookup via BLM's National Public Land Survey System.

Tax-sale records from AR COSL (and MO Collector sales, once those
parsers populate) carry legal descriptions in Public Land Survey
System format — `Section 23 Township 2S Range 5E` — but no lat/lng.
Without coordinates the listings can't drop pins on the Map view or
get geo-enriched (soil/flood/elevation/watershed).

BLM publishes the national PLSS polygon dataset as a free ArcGIS
REST service with township- and section-level geometry. We query it
for each unique (state, township, range, section) tuple, compute the
polygon centroid, and stamp it back onto the listing's location.

Two precision tiers:
  1. **Section centroid** (1 mile × 1 mile) — preferred; ~0.5 mile
     max error. Use when the parsed legal has a section number.
  2. **Township centroid** (5 × 5 miles, ~36 sections) — fallback;
     ~2 mile max error. Good enough for a region-scale Map pin and
     still resolves to the right county/HUC-12 watershed.

Caches results in-memory per-run and on disk between runs
(data/plss_cache.json) since PLSS geometry is immutable — once
we've looked up AR/T2S/R5E/Section 23 once, we never need to again.

Free, no API key. BLM asks callers to keep it reasonable; we do one
query per unique PLSS tuple, not per listing.
"""

from __future__ import annotations

import json
import re
import urllib.parse
from pathlib import Path
from threading import Lock
from typing import Any

import config
from logger import get_logger

log = get_logger("plss_lookup")

# BLM public MapServer. Layer 1 = PLSS Township, Layer 2 = PLSS Section.
_BLM_BASE = "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer"

_CACHE_PATH = config.DATA_DIR / "plss_cache.json"
_cache_lock = Lock()
_cache: dict[str, tuple[float, float] | None] | None = None


def _load_cache() -> dict[str, tuple[float, float] | None]:
    global _cache
    if _cache is not None:
        return _cache
    if _CACHE_PATH.exists():
        try:
            raw = json.loads(_CACHE_PATH.read_text())
            _cache = {
                k: (tuple(v) if isinstance(v, list) else None) for k, v in raw.items()
            }
            return _cache
        except (json.JSONDecodeError, OSError):
            pass
    _cache = {}
    return _cache


def _save_cache() -> None:
    if _cache is None:
        return
    try:
        _CACHE_PATH.write_text(
            json.dumps(
                {k: list(v) if v else None for k, v in _cache.items()},
                indent=2,
                sort_keys=True,
            )
        )
    except OSError as e:
        log.info(f"[plss] cache save failed: {e}")


# Matches "Section 23 Township 2S Range 5E" and permutations thereof.
# Flexible on whitespace + case. Section is numeric; township/range
# are `{digits}{NSEW}` (e.g., "2S", "12N").
_PLSS_RE = re.compile(
    r"Section\s+(?P<sec>\d{1,3})\s+Township\s+(?P<tno>\d{1,3})(?P<tdir>[NSns])"
    r"\s+Range\s+(?P<rno>\d{1,3})(?P<rdir>[EWew])",
    re.IGNORECASE,
)


def parse_legal_description(legal: str) -> dict[str, Any] | None:
    """Extract PLSS tokens from a legal description string.

    Returns dict with keys: section, township_no, township_dir,
    range_no, range_dir (all strings, uppercase). None on no match.
    """
    if not legal:
        return None
    m = _PLSS_RE.search(legal)
    if not m:
        return None
    return {
        "section": m.group("sec"),
        "township_no": m.group("tno"),
        "township_dir": m.group("tdir").upper(),
        "range_no": m.group("rno"),
        "range_dir": m.group("rdir").upper(),
    }


def _polygon_centroid(rings: list[list[list[float]]]) -> tuple[float, float] | None:
    """Quick centroid (mean of ring points). For a square-ish PLSS
    section/township polygon, mean-of-vertices is within a few
    hundred feet of the true area centroid."""
    if not rings or not rings[0]:
        return None
    pts = rings[0]
    n = len(pts)
    if n == 0:
        return None
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    return cx, cy


def _query_blm(layer: int, where: str, timeout: int = 30) -> dict[str, Any] | None:
    """Run an ArcGIS REST /query against the BLM PLSS service. Returns
    parsed JSON or None on failure. Uses curl_cffi so TLS fingerprint
    matches a real browser (plain requests occasionally 403s from
    some IPs against this server)."""
    try:
        from curl_cffi import requests as cffi_requests  # type: ignore[import-not-found]
    except ImportError:
        log.info("[plss] curl_cffi not installed; BLM lookups disabled")
        return None
    # outFields="*" — BLM rejects queries whose outFields list contains
    # any name not present on the target layer (Township lacks
    # FRSTDIVNO; Section lacks TWNSHPLAB). Wildcard sidesteps the
    # layer-specific schema dance and keeps the caller simple.
    params = {
        "where": where,
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "json",
    }
    url = f"{_BLM_BASE}/{layer}/query?{urllib.parse.urlencode(params)}"
    try:
        r = cffi_requests.get(url, impersonate="chrome131", timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.info(f"[plss] BLM query failed ({layer}): {type(e).__name__}: {e}")
        return None


def lookup(
    state: str,
    section: str | None,
    township_no: str,
    township_dir: str,
    range_no: str,
    range_dir: str,
) -> tuple[float, float] | None:
    """Resolve a PLSS tuple to (lat, lng) via the BLM cadastral service.

    Tries the section-level polygon first (Layer 2) for ~0.5 mile
    precision. Falls back to the township polygon (Layer 1) if no
    section match. Zero-pads the BLM-expected 3-digit string format.
    Caches all results — positive and negative — keyed by the tuple.
    """
    cache = _load_cache()
    cache_key = f"{state}:{section or ''}:{township_no}{township_dir}:{range_no}{range_dir}"
    with _cache_lock:
        if cache_key in cache:
            return cache[cache_key]

    # BLM expects zero-padded 3-digit strings for TWNSHPNO / RANGENO,
    # but only 2-digit for FRSTDIVNO (section — max 36 per township).
    tno_padded = township_no.zfill(3)
    rno_padded = range_no.zfill(3)
    sec_padded = section.zfill(2) if section else None

    state = state.upper()
    td = township_dir.upper()
    rd = range_dir.upper()

    result: tuple[float, float] | None = None

    # Tier 1: section polygon lookup via PLSSID prefix + section number.
    # Township PLSSID format is STATE+MER+TNO+FRAC+TDIR+RNO+FRAC+RDIR+DUP,
    # e.g. 'AR050020S0050E0'. We don't know the meridian code up front,
    # so we first resolve the township PLSSID, then use it to scope the
    # section query.
    township_where = (
        f"STATEABBR='{state}' AND TWNSHPNO='{tno_padded}' AND "
        f"TWNSHPDIR='{td}' AND RANGENO='{rno_padded}' AND RANGEDIR='{rd}'"
    )
    twp_data = _query_blm(1, township_where)
    plss_id = None
    if twp_data and twp_data.get("features"):
        feat = twp_data["features"][0]
        plss_id = feat.get("attributes", {}).get("PLSSID")

    if sec_padded and plss_id:
        # Sections live under the township by PLSSID prefix, filtered
        # by FRSTDIVNO (the section number as string).
        sec_where = f"PLSSID='{plss_id}' AND FRSTDIVNO='{sec_padded}'"
        sec_data = _query_blm(2, sec_where)
        if sec_data and sec_data.get("features"):
            geom = sec_data["features"][0].get("geometry", {})
            result = _polygon_centroid(geom.get("rings", []))

    # Tier 2: township centroid fallback — still useful for map pin
    # + county-level enrichment.
    if result is None and twp_data and twp_data.get("features"):
        geom = twp_data["features"][0].get("geometry", {})
        result = _polygon_centroid(geom.get("rings", []))
    # BLM returns (x, y) = (lng, lat). Swap for our (lat, lng) convention.
    if result is not None:
        result = (result[1], result[0])

    with _cache_lock:
        cache[cache_key] = result
        _save_cache()

    return result


def lookup_from_legal(
    state: str, legal_description: str
) -> tuple[float, float] | None:
    """Convenience wrapper — parse then look up. Returns None if the
    legal description doesn't match the PLSS pattern."""
    parsed = parse_legal_description(legal_description)
    if not parsed:
        return None
    return lookup(
        state=state,
        section=parsed["section"],
        township_no=parsed["township_no"],
        township_dir=parsed["township_dir"],
        range_no=parsed["range_no"],
        range_dir=parsed["range_dir"],
    )
