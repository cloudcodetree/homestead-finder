"""Saved-search alert worker.

Runs nightly after the scrape completes. For each active saved search
in Supabase:
  1. Load the user's filter payload.
  2. Apply the filter to the current listings.json corpus.
  3. Subtract any ids already emailed in last_notified_ids.
  4. If matches remain and the cadence allows, email the user.
  5. Update last_notified_at + append new ids to last_notified_ids.

Supabase access goes through a service-role key (env:
`SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_URL`). The service role
bypasses RLS, which we need because the worker reads across users.
Keep this key out of the repo — use GitHub secrets for CI.

Usage:
    python -m scraper.alerts                 # process all due searches
    python -m scraper.alerts --dry-run       # log what would be sent
    python -m scraper.alerts --user <uuid>   # only one user's searches
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

import config
from logger import get_logger
from notifier import SENDGRID_API_KEY

log = get_logger("alerts")


_LIST_CAP = 25  # max listings per email
_ID_HISTORY_CAP = 1000  # most recent notified ids we keep per search


def _supabase_headers() -> dict[str, str]:
    """Headers for authenticated REST calls against Supabase."""
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_ANON_KEY", ""
    )
    if not key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY for local testing) required"
        )
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _supabase_base() -> str:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL env var required")
    return base


def fetch_active_searches(user_filter: str | None = None) -> list[dict[str, Any]]:
    """Read saved_searches rows where notify_cadence != 'none'."""
    url = (
        f"{_supabase_base()}/rest/v1/saved_searches"
        "?notify_cadence=neq.none"
        "&select=id,user_id,name,filters,notify_cadence,last_notified_at,last_notified_ids"
    )
    if user_filter:
        url += f"&user_id=eq.{user_filter}"
    r = requests.get(url, headers=_supabase_headers(), timeout=20)
    r.raise_for_status()
    return r.json()


def fetch_user_email(user_id: str) -> str | None:
    """Look up the email address for a user via the Admin API."""
    url = f"{_supabase_base()}/auth/v1/admin/users/{user_id}"
    r = requests.get(url, headers=_supabase_headers(), timeout=10)
    if r.status_code != 200:
        return None
    return r.json().get("email")


def _is_due(cadence: str, last_notified_at: str | None) -> bool:
    """True iff enough time has elapsed to send another email for this
    cadence. No previous alert → always due."""
    if not last_notified_at:
        return True
    try:
        last = datetime.fromisoformat(last_notified_at.replace("Z", "+00:00"))
    except ValueError:
        return True
    now = datetime.now(timezone.utc)
    if cadence == "daily":
        return now - last >= timedelta(hours=23)
    if cadence == "weekly":
        return now - last >= timedelta(days=6, hours=23)
    return False


def _apply_filters(
    listings: list[dict[str, Any]], filters: dict[str, Any]
) -> list[dict[str, Any]]:
    """Minimal Python re-implementation of the frontend FilterState.
    Keeps the worker dependency-free — no need to spin up a JS runtime
    to replicate filter logic."""
    min_price = float(filters.get("minPrice") or 0)
    max_price = float(filters.get("maxPrice") or float("inf"))
    min_acr = float(filters.get("minAcreage") or 0)
    max_acr = float(filters.get("maxAcreage") or float("inf"))
    max_ppa = float(filters.get("maxPricePerAcre") or float("inf"))
    states = set(s.upper() for s in (filters.get("states") or []))
    features_any = set(filters.get("features") or [])
    sources_any = set(filters.get("sources") or [])
    variants_any = set(filters.get("listingVariants") or [])
    ai_tags_any = set(filters.get("aiTags") or [])
    min_deal = int(filters.get("minDealScore") or 0)
    min_fit = int(filters.get("minHomesteadFit") or 0)
    hide_red = bool(filters.get("hideWithRedFlags"))
    hide_inactive = bool(filters.get("hideInactive", True))

    matches: list[dict[str, Any]] = []
    for p in listings:
        price = float(p.get("price") or 0)
        acres = float(p.get("acreage") or 0)
        ppa = float(p.get("pricePerAcre") or 0)
        if not (min_price <= price <= max_price):
            continue
        if not (min_acr <= acres <= max_acr):
            continue
        if ppa > max_ppa:
            continue
        loc = p.get("location") or {}
        if states and str(loc.get("state", "")).upper() not in states:
            continue
        if sources_any and p.get("source") not in sources_any:
            continue
        if features_any and not features_any.intersection(p.get("features") or []):
            continue
        if variants_any and p.get("listingVariant") not in variants_any:
            continue
        if ai_tags_any and not ai_tags_any.intersection(p.get("aiTags") or []):
            continue
        if int(p.get("dealScore") or 0) < min_deal:
            continue
        if int(p.get("homesteadFitScore") or 0) < min_fit:
            continue
        if hide_red and (p.get("redFlags") or []):
            continue
        if hide_inactive and p.get("status") in ("expired", "pending", "sold"):
            continue
        matches.append(p)
    return matches


def _build_email_body(search_name: str, matches: list[dict[str, Any]]) -> str:
    rows = ""
    for m in matches[:_LIST_CAP]:
        loc = m.get("location", {}) or {}
        rows += (
            f'<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">'
            f'<b>{m.get("title","")[:80]}</b><br>'
            f'<span style="color:#666">'
            f'{m.get("acreage",0):.0f} ac · ${m.get("price",0):,.0f} · '
            f'{loc.get("county","")} County, {loc.get("state","")}'
            f"</span><br>"
            f'<a href="{m.get("url","")}" style="color:#16a34a">View listing →</a>'
            f"</td></tr>"
        )
    return (
        f"<h2 style='font-family:system-ui'>🌿 {len(matches)} new match"
        f"{'es' if len(matches) != 1 else ''} for "
        f"&ldquo;{search_name}&rdquo;</h2>"
        f"<table style='font-family:system-ui;border-collapse:collapse;width:100%'>"
        f"{rows}</table>"
        f"<p style='color:#888;font-size:12px;margin-top:16px'>"
        f"You're receiving this because you saved this search on Homestead Finder. "
        f"Manage alerts from your account menu."
        f"</p>"
    )


def _send_email(to_email: str, subject: str, html: str) -> bool:
    if not SENDGRID_API_KEY:
        log.info(f"[alerts] (no SENDGRID_API_KEY) would have emailed {to_email}")
        return False
    import sendgrid
    from sendgrid.helpers.mail import Mail

    sg = sendgrid.SendGridAPIClient(api_key=SENDGRID_API_KEY)
    try:
        resp = sg.client.mail.send.post(
            request_body=Mail(
                from_email="homestead-finder@noreply.com",
                to_emails=to_email,
                subject=subject,
                html_content=html,
            ).get()
        )
        ok = resp.status_code in (200, 202)
        if not ok:
            log.info(f"[alerts] sendgrid status {resp.status_code} for {to_email}")
        return ok
    except Exception as e:  # noqa: BLE001
        log.info(f"[alerts] sendgrid error: {e}")
        return False


def _patch_search(
    search_id: str, notified_ids: list[str], now_iso: str
) -> None:
    url = f"{_supabase_base()}/rest/v1/saved_searches?id=eq.{search_id}"
    body = {
        "last_notified_at": now_iso,
        "last_notified_ids": notified_ids[-_ID_HISTORY_CAP:],
    }
    r = requests.patch(url, headers=_supabase_headers(), json=body, timeout=15)
    if r.status_code not in (200, 204):
        log.info(f"[alerts] failed to patch search {search_id}: {r.status_code}")


def process_alerts(*, dry_run: bool = False, user_filter: str | None = None) -> int:
    """Main entry point. Returns the number of emails sent."""
    listings_path = config.DATA_DIR / "listings.json"
    if not listings_path.exists():
        log.info("[alerts] no listings.json — nothing to match against")
        return 0
    try:
        listings = json.loads(listings_path.read_text())
        if not isinstance(listings, list):
            listings = []
    except (OSError, json.JSONDecodeError) as e:
        log.info(f"[alerts] could not read listings.json: {e}")
        return 0

    try:
        searches = fetch_active_searches(user_filter)
    except Exception as e:  # noqa: BLE001
        log.info(f"[alerts] Supabase fetch failed: {e}")
        return 0

    log.info(f"[alerts] {len(searches)} active saved searches; corpus={len(listings)}")

    sent = 0
    for s in searches:
        if not _is_due(s["notify_cadence"], s.get("last_notified_at")):
            continue
        matches = _apply_filters(listings, s.get("filters") or {})
        already = set(s.get("last_notified_ids") or [])
        new_matches = [m for m in matches if m.get("id") not in already]
        if not new_matches:
            continue
        email = fetch_user_email(s["user_id"])
        if not email:
            log.info(f"[alerts] no email for user {s['user_id']}")
            continue
        name = s.get("name") or "your saved search"
        subject = (
            f"🌿 {len(new_matches)} new match"
            f"{'es' if len(new_matches) != 1 else ''} — {name[:60]}"
        )
        body = _build_email_body(name, new_matches)
        if dry_run:
            log.info(
                f"[alerts] (dry-run) would email {email} about "
                f"{len(new_matches)} matches for {name!r}"
            )
            continue
        if not _send_email(email, subject, body):
            continue
        sent += 1
        now_iso = datetime.now(timezone.utc).isoformat()
        combined = list(already) + [m.get("id") for m in new_matches]
        _patch_search(s["id"], combined, now_iso)
    return sent


def main() -> None:
    ap = argparse.ArgumentParser(prog="alerts")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--user", help="Only process saved searches for this user UUID")
    args = ap.parse_args()
    n = process_alerts(dry_run=args.dry_run, user_filter=args.user)
    log.info(f"[alerts] {'(dry-run) ' if args.dry_run else ''}sent {n} emails")


if __name__ == "__main__":
    main()
