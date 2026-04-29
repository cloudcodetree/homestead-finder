"""Reverse-geocode listings via Census Geocoder API.

For each listing with valid lat/lng, look up the FIPS county and
update `location.county`. Persists incrementally so a crash mid-run
doesn't lose progress.

Usage:
    python -m reverse_geo
"""
import json
import sys
import time
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlencode
from urllib.error import URLError, HTTPError

import config

LISTINGS = config.DATA_DIR / "listings.json"

# FIPS state code → USPS abbreviation (only need MO/AR + neighbors that
# might appear if a listing's lat/lng is just outside the state line).
FIPS_TO_ABBR = {
    "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT",
    "10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL",
    "18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD",
    "25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE",
    "32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND",
    "39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD",
    "47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV",
    "55":"WI","56":"WY",
}

def geocode(lat, lng):
    """Return (state_abbr, county_name) for a coord, or None on miss."""
    qs = urlencode({
        "x": str(lng),
        "y": str(lat),
        "benchmark": "Public_AR_Current",
        "vintage": "Current_Current",
        "format": "json",
    })
    url = f"https://geocoding.geo.census.gov/geocoder/geographies/coordinates?{qs}"
    try:
        with urlopen(url, timeout=15) as r:
            data = json.load(r)
    except (URLError, HTTPError, json.JSONDecodeError) as e:
        return None
    counties = data.get("result", {}).get("geographies", {}).get("Counties", [])
    if not counties:
        return None
    c = counties[0]
    state_abbr = FIPS_TO_ABBR.get(c.get("STATE", ""))
    name = c.get("NAME") or ""
    if not state_abbr or not name:
        return None
    return state_abbr, name

def main():
    listings = json.loads(LISTINGS.read_text())
    todo_idx = []
    for i, item in enumerate(listings):
        loc = item.get("location") or {}
        lat = loc.get("lat")
        lng = loc.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        if lat == 0 and lng == 0:
            continue
        todo_idx.append(i)
    print(f"reverse-geocoding {len(todo_idx)} listings", flush=True)

    stats = {"matched": 0, "filled": 0, "fixed": 0, "kept": 0, "out_of_state": 0, "miss": 0}
    last_persist = time.time()
    PERSIST_EVERY_S = 30
    for n, idx in enumerate(todo_idx, 1):
        item = listings[idx]
        loc = item.get("location") or {}
        lat = loc["lat"]
        lng = loc["lng"]
        cur_state = (loc.get("state") or "").upper()
        cur_county = (loc.get("county") or "").strip()

        result = geocode(lat, lng)
        if result is None:
            stats["miss"] += 1
        else:
            new_state, new_county_name = result
            stats["matched"] += 1
            # Sanity: if scraped state differs from FIPS state, the
            # listing's lat/lng is probably wrong (or the parcel
            # straddles a state line and was tagged to the wrong side).
            # Trust the listing's own state — don't overwrite it from
            # geocode, but use the geocode's county name when its
            # state agrees.
            if cur_state and new_state != cur_state:
                stats["out_of_state"] += 1
            else:
                # State matches (or listing has no state — rare). Keep
                # the county. Use the bare name (no "County" suffix
                # since voting normalize strips it anyway, but the
                # field convention is to include it for display).
                new_county = f"{new_county_name} County" if not new_county_name.lower().endswith("county") else new_county_name
                if not cur_county:
                    loc["county"] = new_county
                    item["location"] = loc
                    stats["filled"] += 1
                elif cur_county.lower() != new_county.lower():
                    loc["county"] = new_county
                    item["location"] = loc
                    stats["fixed"] += 1
                else:
                    stats["kept"] += 1
        if n % 25 == 0:
            print(f"  [{n}/{len(todo_idx)}] {stats}", flush=True)
        # Throttle ~0.25s/req to stay polite.
        time.sleep(0.25)
        # Persist every ~30s so crash doesn't lose work.
        if time.time() - last_persist > PERSIST_EVERY_S:
            LISTINGS.write_text(json.dumps(listings, indent=2))
            last_persist = time.time()

    LISTINGS.write_text(json.dumps(listings, indent=2))
    print(f"Done. {stats}")

if __name__ == "__main__":
    main()
