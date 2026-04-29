"""Forward-geocode landwatch listings via Census batch endpoint.

LandWatch description fields lead with a structured address:
    "<street>, <city>, <state>, <zip>, <county> — <free description>"

Census `geographies/addressbatch` accepts up to 10,000 rows per call
and returns coords + county FIPS in one go. We send up to 1000 per
request to stay well under the limit and avoid timeouts. Listings
that don't match (placeholder street numbers like "000", "TBD") fall
through to a second batch using just "<city>, <state> <zip>" — that
gets ZIP-centroid coordinates, which is good enough to enable the
geo-enrichment cascade (soil, watershed, proximity).

Usage:
    python -m forward_geo
"""
import csv
import io
import json
import re
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

import config

LISTINGS = config.DATA_DIR / "listings.json"
ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/addressbatch"
BATCH = 500

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

# LandWatch description prefix is well-formed:
#   "<street>, <city>, <state>, <zip>, <county>"
# Followed optionally by " — <free text>".
ADDR_RE = re.compile(
    r"^([^,]+),\s*([^,]+),\s*([A-Z]{2}),\s*(\d{5}(?:-\d{4})?)"
)


def extract_address(listing):
    """Return (street, city, state, zip) or None."""
    desc = (listing.get("description") or listing.get("address") or "").strip()
    m = ADDR_RE.match(desc)
    if not m:
        return None
    street = m.group(1).strip()
    city = m.group(2).strip()
    state = m.group(3).strip()
    zip_ = m.group(4).strip()
    return street, city, state, zip_


def geocode_batch(rows, fallback_zip_only=False):
    """Send a list of (id, street, city, state, zip) tuples; return
    dict id -> (lat, lng, state_abbr, county_name) for matches.
    """
    if not rows:
        return {}
    buf = io.StringIO()
    w = csv.writer(buf)
    for rid, street, city, state, zip_ in rows:
        if fallback_zip_only:
            # Drop street; just submit "city, state zip"
            w.writerow([rid, "", city, state, zip_])
        else:
            w.writerow([rid, street, city, state, zip_])
    csv_bytes = buf.getvalue().encode()

    boundary = "----HFGeocodeBoundary"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="addressFile"; filename="addrs.csv"\r\n'
        "Content-Type: text/csv\r\n\r\n"
    ).encode() + csv_bytes + (
        f"\r\n--{boundary}\r\n"
        'Content-Disposition: form-data; name="benchmark"\r\n\r\n'
        "Public_AR_Current\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="vintage"\r\n\r\n'
        "Current_Current\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    req = Request(
        ENDPOINT,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urlopen(req, timeout=120) as r:
            text = r.read().decode("utf-8", "replace")
    except (URLError, HTTPError) as e:
        print(f"  batch error: {e}", flush=True)
        return {}

    # Response is CSV without header:
    # id, input_addr, match_status, match_type, matched_addr, lon_lat,
    # tigerline_id, side, state_fips, county_fips, tract, block
    out = {}
    rdr = csv.reader(io.StringIO(text))
    for row in rdr:
        if len(row) < 9:
            continue
        rid = row[0]
        status = row[2]
        if status != "Match":
            continue
        latlng = row[5]
        if "," not in latlng:
            continue
        try:
            lng_str, lat_str = latlng.split(",", 1)
            lng = float(lng_str)
            lat = float(lat_str)
        except ValueError:
            continue
        state_fips = row[8] if len(row) > 8 else ""
        county_fips = row[9] if len(row) > 9 else ""
        # Census Geographies-batch returns FIPS only — we resolve
        # county NAME via the voting_county.json keys lazily later.
        out[rid] = (lat, lng, state_fips, county_fips)
    return out


def fips_to_county_name(state_fips, county_fips, county_lookup):
    """Resolve a (state_fips, county_fips) pair to a county name.
    Census doesn't return the name in batch responses, only the FIPS.
    The `county_lookup` map (built from a TIGER GeoNames export) maps
    GEOID -> name. Without it we leave county empty and let voting
    enrichment skip the row.
    """
    geoid = f"{state_fips}{county_fips}"
    return county_lookup.get(geoid)


def fetch_county_name_dict():
    """Fetch a tiny CSV mapping FIPS GEOID -> "Name County" form. The
    Census Bureau publishes county_geocode files; we use the static
    one cached from the 2020 cartographic boundary file metadata."""
    url = "https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt"
    try:
        with urlopen(url, timeout=30) as r:
            text = r.read().decode("latin-1", "replace")
    except (URLError, HTTPError):
        return {}
    out = {}
    # Format: STATE|STATEFP|COUNTYFP|COUNTYNAME|CLASSFP|FUNCSTAT
    for ln in text.splitlines():
        parts = ln.split("|")
        if len(parts) < 4:
            continue
        if parts[0] == "STATE":
            continue
        sfp, cfp, name = parts[1], parts[2], parts[3]
        out[f"{sfp}{cfp}"] = name
    return out


def main():
    listings = json.loads(LISTINGS.read_text())
    pending = []
    for i, item in enumerate(listings):
        if item.get("source") not in ("landwatch", "landhub"):
            continue
        loc = item.get("location") or {}
        if isinstance(loc.get("lat"), (int, float)) and loc.get("lat") not in (0, None):
            continue
        addr = extract_address(item)
        if not addr:
            continue
        pending.append((str(i), *addr, item.get("id", "")))

    print(f"forward-geocoding {len(pending)} addresses", flush=True)
    print("loading county FIPS -> name map...", flush=True)
    county_lookup = fetch_county_name_dict()
    print(f"  {len(county_lookup)} county records loaded", flush=True)

    stats = {"matched_first": 0, "matched_zip": 0, "missed": 0, "filled_coords": 0, "filled_county": 0}
    last_persist = time.time()
    PERSIST_EVERY_S = 30

    # Pass 1: full address
    for batch_start in range(0, len(pending), BATCH):
        batch = pending[batch_start : batch_start + BATCH]
        rows = [(p[0], p[1], p[2], p[3], p[4]) for p in batch]
        results = geocode_batch(rows, fallback_zip_only=False)
        for p in batch:
            row_id = p[0]
            idx = int(row_id)
            res = results.get(row_id)
            if not res:
                continue
            lat, lng, sfp, cfp = res
            stats["matched_first"] += 1
            item = listings[idx]
            loc = item.get("location") or {}
            if loc.get("lat") in (0, None) or not isinstance(loc.get("lat"), (int, float)):
                loc["lat"] = lat
                loc["lng"] = lng
                stats["filled_coords"] += 1
            cname = fips_to_county_name(sfp, cfp, county_lookup)
            cur_county = (loc.get("county") or "").strip()
            if cname and not cur_county:
                # Census name may end in " County" — keep it.
                if not cname.lower().endswith("county"):
                    cname = f"{cname} County"
                loc["county"] = cname
                stats["filled_county"] += 1
            item["location"] = loc
        print(f"  pass1 batch {batch_start//BATCH + 1}/{(len(pending)+BATCH-1)//BATCH}: {stats}", flush=True)
        if time.time() - last_persist > PERSIST_EVERY_S:
            LISTINGS.write_text(json.dumps(listings, indent=2))
            last_persist = time.time()
        time.sleep(1.0)  # polite

    # Pass 2: ZIP-only fallback for unmatched
    unmatched = [
        p for p in pending
        if not isinstance((listings[int(p[0])].get("location") or {}).get("lat"), (int, float))
        or (listings[int(p[0])].get("location") or {}).get("lat") in (0, None)
    ]
    print(f"\nfallback ZIP-only pass: {len(unmatched)} addresses", flush=True)
    for batch_start in range(0, len(unmatched), BATCH):
        batch = unmatched[batch_start : batch_start + BATCH]
        rows = [(p[0], p[1], p[2], p[3], p[4]) for p in batch]
        results = geocode_batch(rows, fallback_zip_only=True)
        for p in batch:
            row_id = p[0]
            idx = int(row_id)
            res = results.get(row_id)
            if not res:
                stats["missed"] += 1
                continue
            lat, lng, sfp, cfp = res
            stats["matched_zip"] += 1
            item = listings[idx]
            loc = item.get("location") or {}
            if loc.get("lat") in (0, None) or not isinstance(loc.get("lat"), (int, float)):
                loc["lat"] = lat
                loc["lng"] = lng
                stats["filled_coords"] += 1
            cname = fips_to_county_name(sfp, cfp, county_lookup)
            cur_county = (loc.get("county") or "").strip()
            if cname and not cur_county:
                if not cname.lower().endswith("county"):
                    cname = f"{cname} County"
                loc["county"] = cname
                stats["filled_county"] += 1
            item["location"] = loc
        print(f"  pass2 batch {batch_start//BATCH + 1}/{(len(unmatched)+BATCH-1)//BATCH}: {stats}", flush=True)
        if time.time() - last_persist > PERSIST_EVERY_S:
            LISTINGS.write_text(json.dumps(listings, indent=2))
            last_persist = time.time()
        time.sleep(1.0)

    LISTINGS.write_text(json.dumps(listings, indent=2))
    print(f"\nDone. {stats}", flush=True)


if __name__ == "__main__":
    main()
