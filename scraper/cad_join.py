"""Join scraped listings to Travis CAD parcels via ArcGIS lookup.

Travis CAD's PACS bulk export (PROP.TXT) gives us per-parcel ownership,
acreage, valuation, and last-deed-date — but its `situs_street` column
only carries the street name, not the house number. So we can't join
listings to parcels by address alone.

Instead we use the public ArcGIS REST endpoint that backs Travis
County's "Zone Lookup" tool:

    EXTERNAL_tcad_parcel layer  →  point-in-polygon query

Each scraped listing has lat/lng. Hitting the layer with that point
returns the polygon's `PROP_ID` and `PID_10` (= our `geoId`). We then
look up the CAD parcel record we already parsed from PROP.TXT and
emit one joined row per matched listing.

Output: `data/cad_joined.json` — a compact `{ listingId → cadRecord }`
map, ~10 KB for the ~74 Travis-county listings. The frontend reads
this on PropertyDetail mount and surfaces the CAD record in a panel
alongside the comp breakdown.

Public API. Light load — 74 queries per run, throttled at 0.5s.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import requests

# ── Travis CAD parcel layer (point-in-polygon)
ARCGIS_URL = (
    "https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/"
    "EXTERNAL_tcad_parcel/FeatureServer/0/query"
)


def lookup_parcel(lat: float, lng: float, session: requests.Session) -> dict[str, Any] | None:
    """Hit the ArcGIS layer for a single lat/lng. Returns the
    `attributes` dict (PROP_ID + PID_10 + SITUS) on a hit, None on
    miss or error. Coords outside Travis County silently miss
    (empty `features` list)."""
    params = {
        "geometry": f"{lng},{lat}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "PROP_ID,PID_10,SITUS",
        "returnGeometry": "false",
        "f": "json",
    }
    try:
        r = session.get(ARCGIS_URL, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # pragma: no cover - defensive
        print(f"  arcgis error: {e}", file=sys.stderr)
        return None
    feats = data.get("features") or []
    if not feats:
        return None
    return feats[0].get("attributes")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--listings",
        type=Path,
        default=Path("data/listings.json"),
        help="Path to scraped listings JSON.",
    )
    ap.add_argument(
        "--parcels",
        type=Path,
        default=Path("data/cad/travis_parcels.json"),
        help="Path to Travis CAD parcels JSON (from cad_travis.py).",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=Path("data/cad_joined.json"),
        help="Output path for the joined CAD-records map.",
    )
    ap.add_argument(
        "--county",
        default="Travis",
        help="Filter listings to this county before lookup.",
    )
    args = ap.parse_args()

    listings = json.loads(args.listings.read_text())
    parcels = json.loads(args.parcels.read_text())
    print(
        f"loaded {len(listings):,} listings, {len(parcels):,} CAD parcels",
        file=sys.stderr,
    )

    targets = [
        p for p in listings if (p.get("location") or {}).get("county") == args.county
    ]
    targets = [
        p for p in targets
        if isinstance((p.get("location") or {}).get("lat"), (int, float))
        and isinstance((p.get("location") or {}).get("lng"), (int, float))
        and (p.get("location") or {}).get("lat") != 0
    ]
    print(f"{args.county} listings with coords: {len(targets)}", file=sys.stderr)

    sess = requests.Session()
    sess.headers["User-Agent"] = "homestead-finder/cad-join"

    joined: dict[str, dict[str, Any]] = {}
    misses_no_polygon = 0
    misses_no_parcel = 0
    for i, listing in enumerate(targets):
        loc = listing["location"]
        attrs = lookup_parcel(loc["lat"], loc["lng"], sess)
        if attrs is None:
            misses_no_polygon += 1
            time.sleep(0.5)
            continue
        geo_id = attrs.get("PID_10") or ""
        if geo_id and geo_id in parcels:
            cad = parcels[geo_id]
            # Slim the CAD record down to fields the UI surfaces — the
            # full parcel record has owner-mailing-address bits we don't
            # need on the listing detail page.
            joined[listing["id"]] = {
                "geoId": cad["geoId"],
                "propId": cad.get("propId"),
                "owner": cad.get("owner"),
                "acreage": cad.get("acreage"),
                "lastDeedDate": cad.get("lastDeedDate"),
                "appraisedValue": cad.get("appraisedValue"),
                "assessedValue": cad.get("assessedValue"),
                "landValue": cad.get("landValue"),
                "improvementValue": cad.get("improvementValue"),
                "city": cad.get("city"),
                "zip": cad.get("zip"),
                "valYear": cad.get("valYear"),
                "situs": attrs.get("SITUS") or "",
            }
        else:
            misses_no_parcel += 1
        if (i + 1) % 20 == 0:
            print(
                f"  ... {i + 1}/{len(targets)} processed, {len(joined)} matched",
                file=sys.stderr,
            )
        # Polite throttle — ArcGIS public services don't publish a
        # rate limit but 2 req/s is well within typical "fair use".
        time.sleep(0.5)

    print(
        f"matched: {len(joined)} / {len(targets)} "
        f"(no parcel polygon: {misses_no_polygon}; "
        f"polygon found but no PROP.TXT row: {misses_no_parcel})",
        file=sys.stderr,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(joined, indent=2))
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
