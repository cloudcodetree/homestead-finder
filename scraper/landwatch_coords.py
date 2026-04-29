"""Backfill lat/lng for LandWatch listings missing coords by scraping
the parcel detail page. Each detail page renders a map widget whose
state JSON includes `latitude` and `longitude` directly — easy to
extract via regex.

~0.7 req/sec throttle (curl_cffi Chrome impersonation), ~24 min for
~1k listings. Persists every 30 seconds so a Ctrl-C / crash doesn't
lose work.

Usage:
    python -m landwatch_coords
"""
import json
import random
import re
import sys
import time
from pathlib import Path

import config

LISTINGS = config.DATA_DIR / "listings.json"
THROTTLE_MIN = 1.0
THROTTLE_MAX = 1.6
LAT_RE = re.compile(r'latitude[":\s]+([-+]?\d+\.\d+)')
LNG_RE = re.compile(r'longitude[":\s]+([-+]?\d+\.\d+)')

try:
    from curl_cffi import requests as cffi_requests  # type: ignore
except ImportError:
    print("curl_cffi not installed; aborting")
    sys.exit(2)


def fetch_coords(url):
    """Return (lat, lng) or None if the detail page won't yield."""
    try:
        r = cffi_requests.get(url, impersonate="chrome131", timeout=20)
        if r.status_code != 200:
            return None
        text = r.text
        ml = LAT_RE.search(text)
        mg = LNG_RE.search(text)
        if not ml or not mg:
            return None
        lat = float(ml.group(1))
        lng = float(mg.group(1))
        # Sanity bounds (continental US-ish; loose to allow AK/HI).
        if not (15.0 <= lat <= 72.0 and -180.0 <= lng <= -60.0):
            return None
        # Skip exact 0,0 just in case the page leaks a placeholder.
        if lat == 0 or lng == 0:
            return None
        return lat, lng
    except Exception as e:
        print(f"  err {url[-30:]}: {type(e).__name__}: {e}", flush=True)
        return None


def main():
    listings = json.loads(LISTINGS.read_text())
    todo = []
    for i, item in enumerate(listings):
        if item.get("source") != "landwatch":
            continue
        loc = item.get("location") or {}
        lat = loc.get("lat")
        if isinstance(lat, (int, float)) and lat not in (0, None):
            continue
        url = item.get("url")
        if not url or "landwatch.com" not in url:
            continue
        todo.append((i, url, item.get("id", "")))

    print(f"backfilling coords for {len(todo)} LandWatch listings", flush=True)

    stats = {"matched": 0, "miss": 0}
    last_persist = time.time()
    PERSIST_EVERY_S = 30

    for n, (idx, url, lid) in enumerate(todo, 1):
        result = fetch_coords(url)
        if result is None:
            stats["miss"] += 1
        else:
            lat, lng = result
            item = listings[idx]
            loc = item.get("location") or {}
            loc["lat"] = lat
            loc["lng"] = lng
            item["location"] = loc
            stats["matched"] += 1

        if n % 25 == 0 or n == len(todo):
            print(f"  [{n}/{len(todo)}] {stats}", flush=True)
        if time.time() - last_persist > PERSIST_EVERY_S:
            LISTINGS.write_text(json.dumps(listings, indent=2))
            last_persist = time.time()

        if n < len(todo):
            time.sleep(random.uniform(THROTTLE_MIN, THROTTLE_MAX))

    LISTINGS.write_text(json.dumps(listings, indent=2))
    print(f"\nDone. {stats}", flush=True)


if __name__ == "__main__":
    main()
