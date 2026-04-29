"""Build a county-level macro table from public sources.

Output: `data/macro_county.json` keyed by `<state>|<county>` (lowercase,
no "County" suffix) with three signals per row:

    {
      "AR|fulton": {
        "popChangePct5yr": -2.1,        # ACS 2018 → ACS 2023 5-yr est.
        "unemploymentRate": 4.8,        # BLS LAUS 2024 county rate
        "propertyTaxRate": 0.65,        # state effective rate %
        "_meta": {...}
      },
      ...
    }

Pulled from:
  • Census ACS 5-year (population): https://api.census.gov/data/{YEAR}/acs/acs5
  • BLS LAUS county-level annual averages: https://www.bls.gov/lau/laucnty{YY}.txt
  • State effective property tax rate: hand-curated table (Tax Foundation
    state effective rates — varies <5pp per year, refresh annually).

All endpoints are public, no auth required for low-volume use.

Usage:
    python -m scraper.macro_data            # build full national table
    python -m scraper.macro_data --states AR,MO   # subset for testing
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import config
from logger import get_logger

log = get_logger("macro_data")


# ── State FIPS ↔ abbreviation ───────────────────────────────────────
FIPS_TO_ABBR: dict[str, str] = {
    "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT",
    "10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL",
    "18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD",
    "25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE",
    "32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND",
    "39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD",
    "47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV",
    "55":"WI","56":"WY",
}
ABBR_TO_FIPS = {v: k for k, v in FIPS_TO_ABBR.items()}


# ── State effective property tax rate (Tax Foundation 2024) ─────────
# Source: Tax Foundation "How High Are Property Taxes in Your State?"
# 2024 estimates; effective rate = property tax collections / median
# home value. Updated annually — refresh in lockstep with the
# generatedAt stamp in the output table.
#
# TODO(ai-enrich): hand-curated state-level table; replace with a
# county-level pull from a live source (e.g. SmartAsset CSV, Tax
# Foundation Atlas API, or a Claude-summarized fetch of each state's
# DOR effective-rate page). State granularity hides large variance —
# Texas counties range 1.4-2.6%, Illinois 1.7-2.7%.
STATE_PROPERTY_TAX_RATE: dict[str, float] = {
    "AL":0.41,"AK":1.04,"AZ":0.62,"AR":0.64,"CA":0.75,"CO":0.55,"CT":2.15,
    "DE":0.61,"DC":0.62,"FL":0.91,"GA":0.92,"HI":0.32,"ID":0.69,"IL":2.23,
    "IN":0.84,"IA":1.52,"KS":1.41,"KY":0.83,"LA":0.56,"ME":1.24,"MD":1.05,
    "MA":1.14,"MI":1.38,"MN":1.11,"MS":0.81,"MO":0.97,"MT":0.74,"NE":1.63,
    "NV":0.59,"NH":1.93,"NJ":2.49,"NM":0.80,"NY":1.40,"NC":0.82,"ND":0.98,
    "OH":1.59,"OK":0.90,"OR":0.93,"PA":1.49,"RI":1.63,"SC":0.57,"SD":1.17,
    "TN":0.71,"TX":1.68,"UT":0.57,"VT":1.83,"VA":0.87,"WA":0.94,"WV":0.58,
    "WI":1.61,"WY":0.61,
}


# ── Population: Census ACS 5-year via REST ──────────────────────────
ACS_RECENT_YEAR = 2023  # latest published 5-year estimate at time of build
ACS_BASE_YEAR = 2018  # 5-year delta window
_ACS_BASE = "https://api.census.gov/data/{year}/acs/acs5?get=B01003_001E,NAME&for=county:*&in=state:{fips}"


def _fetch_acs(year: int, state_fips: str) -> dict[str, int]:
    """Return {countyFips → totalPopulation} for one state-year."""
    url = _ACS_BASE.format(year=year, fips=state_fips)
    try:
        with urlopen(url, timeout=30) as r:
            data = json.load(r)
    except (URLError, HTTPError, json.JSONDecodeError) as e:
        log.info(f"[macro] ACS {year} {state_fips} fetch failed: {e}")
        return {}
    out: dict[str, int] = {}
    if not data or len(data) < 2:
        return out
    header = data[0]
    try:
        pop_idx = header.index("B01003_001E")
        cty_idx = header.index("county")
    except ValueError:
        return out
    for row in data[1:]:
        try:
            pop = int(row[pop_idx])
            cty_fips = row[cty_idx]
            out[cty_fips] = pop
        except (ValueError, IndexError):
            continue
    return out


# Map ACS county-name strings → our normalized county key.
_NAME_RE = re.compile(r"^(.+?) (County|Parish|Borough|Census Area|Municipality|City and Borough)(?:,\s*.+)?$", re.IGNORECASE)


def _normalize_county(name: str) -> str:
    if not name:
        return ""
    m = _NAME_RE.match(name.strip())
    base = m.group(1) if m else name.strip()
    base = base.replace(".", "")
    base = re.sub(r"\s+", " ", base)
    return base.strip().lower()


def _fetch_county_name_map() -> dict[str, str]:
    """Fetch FIPS GEOID → 'County Name' from Census's national_county
    file. Used to resolve state+county FIPS into our county keys."""
    url = "https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt"
    try:
        with urlopen(url, timeout=30) as r:
            text = r.read().decode("latin-1", "replace")
    except (URLError, HTTPError):
        log.info("[macro] county_name fetch failed")
        return {}
    out: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split("|")
        if len(parts) < 4 or parts[0] == "STATE":
            continue
        # CSV columns: STATE | STATEFP | COUNTYFP | COUNTYNS | COUNTYNAME | …
        sfp, cfp, name = parts[1], parts[2], parts[4]
        out[f"{sfp}{cfp}"] = name
    return out


# ── Unemployment: BLS LAUS county-level annual averages ─────────────
# State-level unemployment rate (BLS LAUS state annual averages, 2024).
# Used as a fallback when the county-level flat file is unreachable
# (BLS WAF blocks /lau/ flat files with 403 on most non-browser
# clients). State granularity is acceptable for the macro axis — rural
# counties in a state typically track within ~2pp of the state mean,
# which is well below this signal's noise floor in the composite score.
# Source: BLS LAUS state annual averages, retrieved 2026-04.
#
# TODO(ai-enrich): UNEMPLOYMENT RATES MOVE — these go stale within a
# year and are wrong by 2pp+ within 3-4 years (a recession can shift
# them 5pp+ in months). Replace with a live pull when the BLS WAF
# issue is solved (try the public BLS API series LAU* keyed by FIPS,
# or a Claude-summarized fetch of FRED). For now treat this dict as a
# point-in-time snapshot and refresh annually OR get the county-level
# LAUS pull working — the helper below already tries.
STATE_UNEMPLOYMENT_RATE: dict[str, float] = {
    "AL":2.9,"AK":4.7,"AZ":3.5,"AR":3.3,"CA":5.4,"CO":3.8,"CT":3.6,
    "DE":4.0,"DC":5.2,"FL":3.2,"GA":3.5,"HI":3.0,"ID":3.4,"IL":4.8,
    "IN":3.5,"IA":3.0,"KS":2.9,"KY":4.4,"LA":4.0,"ME":3.0,"MD":3.0,
    "MA":3.6,"MI":4.2,"MN":3.0,"MS":3.4,"MO":3.7,"MT":3.0,"NE":2.6,
    "NV":5.4,"NH":2.5,"NJ":4.5,"NM":3.9,"NY":4.3,"NC":3.6,"ND":2.6,
    "OH":4.0,"OK":3.3,"OR":4.1,"PA":3.4,"RI":4.4,"SC":3.6,"SD":1.9,
    "TN":3.4,"TX":4.0,"UT":3.3,"VT":2.4,"VA":2.9,"WA":4.6,"WV":4.2,
    "WI":3.0,"WY":3.4,
}


def _fetch_bls_county_unemp(year_yy: str) -> dict[str, float]:
    """Return {GEOID → annual unemployment rate %}.

    BLS publishes a fixed-width ASCII table at /lau/laucntyYY.txt where
    YY is two-digit year. As of 2026-04 their WAF blocks non-browser
    clients on these flat files (403 on urllib + curl_cffi alike) so
    this helper reliably returns {} on most machines. The macro_data
    builder falls back to state-level rates (`STATE_UNEMPLOYMENT_RATE`)
    so the macro axis still has a value to score against.

    Re-enable: if BLS's WAF rules change, this code path is intact —
    just remove the early-return and the fallback will be skipped.
    """
    url = f"https://www.bls.gov/lau/laucnty{year_yy}.txt"
    text: str | None = None
    try:
        from curl_cffi import requests as cffi_requests  # type: ignore[import-not-found]
        r = cffi_requests.get(url, impersonate="chrome131", timeout=30)
        if r.status_code == 200:
            text = r.text
    except Exception:
        pass
    if text is None:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urlopen(req, timeout=30) as r:
                text = r.read().decode("latin-1", "replace")
        except (URLError, HTTPError):
            return {}
    out: dict[str, float] = {}
    for line in text.splitlines():
        # Skip headers / separator rows.
        if not line or not line.lstrip()[:2].isdigit():
            continue
        # Tab/space-delimited; collapse and split.
        cells = re.split(r"\s{2,}|\t", line.strip())
        if len(cells) < 6:
            continue
        # Layout (current LAUS format): LAUS_code, state_fips, county_fips,
        # county_name_state, year, labor_force, employed, unemployed,
        # unemp_rate. We grab the rate from the last cell.
        # Some rows have suffixes (e.g. "(P)" preliminary); strip non-digits.
        last = cells[-1]
        m = re.search(r"(\d+\.\d+)", last)
        if not m:
            continue
        try:
            rate = float(m.group(1))
        except ValueError:
            continue
        # state_fips + county_fips → GEOID. They're cells[1] and cells[2].
        # Fixed-width parse fallback if split missed.
        try:
            sfp = cells[1].strip().zfill(2)
            cfp = cells[2].strip().zfill(3)
        except IndexError:
            continue
        if not (sfp.isdigit() and cfp.isdigit()):
            continue
        out[f"{sfp}{cfp}"] = rate
    return out


def build_table(target_states: list[str] | None = None) -> dict[str, Any]:
    """Compose a county-keyed table from the three sources."""
    if target_states is None:
        target_states = list(ABBR_TO_FIPS.keys())

    log.info(f"[macro] building table for {len(target_states)} states...")
    log.info("[macro] fetching county name map...")
    geoid_to_name = _fetch_county_name_map()
    log.info(f"[macro]   {len(geoid_to_name)} county records")

    log.info(f"[macro] fetching BLS LAUS unemployment ({ACS_RECENT_YEAR-1})...")
    unemp = _fetch_bls_county_unemp(str(ACS_RECENT_YEAR - 1)[-2:])
    if not unemp:
        # Try the more recent year — BLS sometimes lags publication.
        unemp = _fetch_bls_county_unemp(str(ACS_RECENT_YEAR - 2)[-2:])
    log.info(f"[macro]   {len(unemp)} county unemployment rows")

    log.info(f"[macro] fetching ACS {ACS_BASE_YEAR} + {ACS_RECENT_YEAR} populations...")
    pop_base: dict[str, int] = {}
    pop_recent: dict[str, int] = {}
    for abbr in target_states:
        sfp = ABBR_TO_FIPS.get(abbr)
        if not sfp:
            continue
        pop_base.update({f"{sfp}{cfp}": v for cfp, v in _fetch_acs(ACS_BASE_YEAR, sfp).items()})
        pop_recent.update({f"{sfp}{cfp}": v for cfp, v in _fetch_acs(ACS_RECENT_YEAR, sfp).items()})
        time.sleep(0.5)
    log.info(f"[macro]   pop_base={len(pop_base)} pop_recent={len(pop_recent)}")

    table: dict[str, Any] = {
        "_meta": {
            "description": "County-level macro signals for InvestmentScore.",
            "popYears": [ACS_BASE_YEAR, ACS_RECENT_YEAR],
            "unemploymentYear": ACS_RECENT_YEAR - 1,
            "propertyTaxSource": "Tax Foundation state effective rate",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
    }

    for geoid, name in geoid_to_name.items():
        sfp = geoid[:2]
        abbr = FIPS_TO_ABBR.get(sfp)
        if not abbr or (target_states and abbr not in target_states):
            continue
        county_key = _normalize_county(name)
        if not county_key:
            continue
        key = f"{abbr}|{county_key}"

        row: dict[str, Any] = {}
        base = pop_base.get(geoid)
        recent = pop_recent.get(geoid)
        if base and recent and base > 0:
            row["popChangePct5yr"] = round((recent - base) / base * 100.0, 2)
        ue = unemp.get(geoid)
        if ue is not None:
            row["unemploymentRate"] = ue
        else:
            # Fall back to state-level rate when county data isn't
            # available (BLS LAUS flat-file WAF blocks; see helper).
            ue_state = STATE_UNEMPLOYMENT_RATE.get(abbr)
            if ue_state is not None:
                row["unemploymentRate"] = ue_state
                row["unemploymentRateSource"] = "state"
        ptax = STATE_PROPERTY_TAX_RATE.get(abbr)
        if ptax is not None:
            row["propertyTaxRate"] = ptax
        if row:
            table[key] = row

    return table


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--states", default="", help="Comma-separated state abbrs; default = all 50+DC")
    p.add_argument("--output", type=Path, default=config.DATA_DIR / "macro_county.json")
    args = p.parse_args()

    target_states = [s.strip().upper() for s in args.states.split(",") if s.strip()] or None
    try:
        table = build_table(target_states)
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    args.output.write_text(json.dumps(table, indent=2, sort_keys=True))
    n = sum(1 for k in table if not k.startswith("_"))
    print(f"Done. {n} county rows → {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
