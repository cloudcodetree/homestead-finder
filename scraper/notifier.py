"""Email notification sender using SendGrid."""

from __future__ import annotations

from typing import Any

import sendgrid
from sendgrid.helpers.mail import Mail

from config import SENDGRID_API_KEY, NOTIFICATION_EMAIL, NOTIFICATION_SCORE_THRESHOLD
from utils.formatters import format_price, format_acreage, format_price_per_acre


def send_deal_alert(hot_deals: list[dict[str, Any]]) -> bool:
    """Send email notification for hot deals. Returns True on success."""
    if not SENDGRID_API_KEY or not NOTIFICATION_EMAIL:
        print(
            "  [notifier] No SendGrid API key or email configured — skipping notification"
        )
        return False

    if not hot_deals:
        return True

    subject = f"🌿 {len(hot_deals)} New Homestead Deal{'s' if len(hot_deals) > 1 else ''} Found"
    body = _build_email_body(hot_deals)

    try:
        sg = sendgrid.SendGridAPIClient(api_key=SENDGRID_API_KEY)
        message = Mail(
            from_email="homestead-finder@noreply.com",
            to_emails=NOTIFICATION_EMAIL,
            subject=subject,
            html_content=body,
        )
        response = sg.client.mail.send.post(request_body=message.get())
        if response.status_code in (200, 202):
            print(
                f"  [notifier] Alert sent for {len(hot_deals)} deals → {NOTIFICATION_EMAIL}"
            )
            return True
        else:
            print(f"  [notifier] SendGrid error: {response.status_code}")
            return False
    except Exception as e:
        print(f"  [notifier] Failed to send alert: {e}")
        return False


def _build_email_body(deals: list[dict[str, Any]]) -> str:
    """Build HTML email body for deal alert."""
    rows = ""
    for deal in deals[:20]:  # Cap at 20 deals per email
        loc = deal.get("location", {})
        state = loc.get("state", "")
        county = loc.get("county", "")
        score = deal.get("dealScore", 0)
        score_color = (
            "#22c55e" if score >= 80 else "#eab308" if score >= 65 else "#f97316"
        )

        rows += f"""
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:12px 8px;">
            <strong style="display:block;">{deal.get("title", "Land Listing")}</strong>
            <span style="color:#6b7280;font-size:13px;">{county} County, {state}</span>
          </td>
          <td style="padding:12px 8px;text-align:right;">
            <strong>{format_price(deal.get("price", 0))}</strong><br>
            <span style="color:#6b7280;font-size:13px;">{format_price_per_acre(deal.get("pricePerAcre", 0))}</span>
          </td>
          <td style="padding:12px 8px;text-align:center;">
            {format_acreage(deal.get("acreage", 0))}
          </td>
          <td style="padding:12px 8px;text-align:center;">
            <span style="background:{score_color};color:white;border-radius:12px;padding:2px 10px;font-weight:bold;">
              {score}
            </span>
          </td>
          <td style="padding:12px 8px;text-align:center;">
            <a href="{deal.get("url", "#")}"
               style="color:#16a34a;font-weight:600;text-decoration:none;">View →</a>
          </td>
        </tr>
        """

    return f"""
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#111827;">
      <h1 style="color:#15803d;margin-bottom:4px;">🌿 Homestead Finder</h1>
      <p style="color:#6b7280;margin-top:0;">
        {len(deals)} new deal{"s" if len(deals) > 1 else ""} with score ≥ {NOTIFICATION_SCORE_THRESHOLD}
      </p>

      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <thead>
          <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
            <th style="padding:8px;text-align:left;">Property</th>
            <th style="padding:8px;text-align:right;">Price</th>
            <th style="padding:8px;text-align:center;">Acres</th>
            <th style="padding:8px;text-align:center;">Score</th>
            <th style="padding:8px;text-align:center;">Link</th>
          </tr>
        </thead>
        <tbody>
          {rows}
        </tbody>
      </table>

      <p style="margin-top:24px;font-size:13px;color:#9ca3af;">
        Sent by Homestead Finder — deals scoring above {NOTIFICATION_SCORE_THRESHOLD}/100.<br>
        <a href="https://github.com/cloudcodetree/homestead-finder" style="color:#16a34a;">
          View dashboard
        </a>
      </p>
    </body>
    </html>
    """


def filter_hot_deals(
    properties: list[dict[str, Any]],
    threshold: int = NOTIFICATION_SCORE_THRESHOLD,
    previously_seen: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Return properties above threshold that haven't been notified about."""
    if previously_seen is None:
        previously_seen = set()
    return [
        p
        for p in properties
        if p.get("dealScore", 0) >= threshold and p.get("id", "") not in previously_seen
    ]


# ── Homestead-gem alerts (new listings that pass the Deals filter) ─────────

# Minimum AI fit score for a listing to count as a "gem worth alerting".
# 70 sits above the midline but below the "curated top pick" bar. Tuned
# against the existing MT enrichment distribution.
GEM_MIN_HOMESTEAD_FIT = 70

# Minimum rule-based deal score — sets a floor on the price/acre
# economics regardless of what the AI thinks.
GEM_MIN_DEAL_SCORE = 60


def filter_homestead_gems(
    properties: list[dict[str, Any]],
    previously_seen: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Return new listings that meet the "homestead gem" bar:

    - `status != 'tax_sale'` (tax sales have a different workflow)
    - Passes the same hard filters as scraper/deals.py (price ≤ $500k,
      ≥5 acres, no critical red flags, not in FEMA SFHA, soil ≤ class 6)
    - homesteadFitScore ≥ GEM_MIN_HOMESTEAD_FIT
    - dealScore ≥ GEM_MIN_DEAL_SCORE
    - Not previously notified

    Imports deals lazily so notifier.py stays importable in minimal envs
    (CI doesn't always install the full scraper tree).
    """
    # Lazy import to avoid pulling the whole scraper tree when callers
    # just want `send_deal_alert` (the original interface).
    from deals import passes_hard_filters as _deals_filter

    if previously_seen is None:
        previously_seen = set()

    gems: list[dict[str, Any]] = []
    for item in properties:
        if item.get("id", "") in previously_seen:
            continue
        fit = item.get("homesteadFitScore")
        deal = item.get("dealScore") or 0
        if fit is None or fit < GEM_MIN_HOMESTEAD_FIT:
            continue
        if deal < GEM_MIN_DEAL_SCORE:
            continue
        ok, _why = _deals_filter(item)
        if not ok:
            continue
        gems.append(item)
    # Sort by (fit desc, deal desc) so the best gem heads the digest
    gems.sort(
        key=lambda p: (p.get("homesteadFitScore", 0), p.get("dealScore", 0)),
        reverse=True,
    )
    return gems


def send_homestead_gems_alert(gems: list[dict[str, Any]]) -> bool:
    """Send a focused email digest of new homestead gems.

    Returns True on success (or if the config silently skips because
    SendGrid isn't configured — we don't treat unset creds as an error).
    """
    if not SENDGRID_API_KEY or not NOTIFICATION_EMAIL:
        print(
            "  [notifier] SendGrid not configured — skipping homestead-gem alert "
            f"({len(gems)} gems would have been sent)"
        )
        return False
    if not gems:
        return True

    subject = (
        f"🌾 {len(gems)} new homestead gem{'s' if len(gems) != 1 else ''} detected"
    )
    body = _build_gem_email_body(gems)

    try:
        sg = sendgrid.SendGridAPIClient(api_key=SENDGRID_API_KEY)
        message = Mail(
            from_email="homestead-finder@noreply.com",
            to_emails=NOTIFICATION_EMAIL,
            subject=subject,
            html_content=body,
        )
        response = sg.client.mail.send.post(request_body=message.get())
        if response.status_code in (200, 202):
            print(
                f"  [notifier] Gem alert sent for {len(gems)} gems → {NOTIFICATION_EMAIL}"
            )
            return True
        print(f"  [notifier] SendGrid error: {response.status_code}")
        return False
    except Exception as e:
        print(f"  [notifier] Failed to send gem alert: {e}")
        return False


def _build_gem_email_body(gems: list[dict[str, Any]]) -> str:
    """HTML digest for homestead gems. Includes AI summary and soil/flood
    data so the recipient can triage without clicking through."""
    rows = ""
    for gem in gems[:20]:
        loc = gem.get("location", {}) or {}
        state = loc.get("state", "")
        county = loc.get("county", "")
        fit = gem.get("homesteadFitScore", 0)
        ai_summary = gem.get("aiSummary", "") or "(not yet analyzed)"
        soil = (gem.get("geoEnrichment") or {}).get("soil") or {}
        soil_line = (
            f"Soil class {soil.get('capabilityClass', '?')}"
            if soil.get("capabilityClass")
            else ""
        )
        flood = (gem.get("geoEnrichment") or {}).get("flood") or {}
        flood_line = f"Zone {flood.get('floodZone')}" if flood.get("floodZone") else ""
        geo_footer = " · ".join(x for x in (soil_line, flood_line) if x)

        rows += f"""
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:14px 10px;vertical-align:top;">
            <strong style="display:block;font-size:15px;">{gem.get("title", "Land Listing")}</strong>
            <span style="color:#6b7280;font-size:12px;">
              {county} County, {state} · {format_acreage(gem.get("acreage", 0))} · {format_price(gem.get("price", 0))}
              · {format_price_per_acre(gem.get("pricePerAcre", 0))}
            </span>
            {"<div style='color:#6b7280;font-size:12px;margin-top:4px;'>" + geo_footer + "</div>" if geo_footer else ""}
            <p style="font-size:13px;color:#374151;margin:6px 0 0 0;line-height:1.4;">{ai_summary}</p>
          </td>
          <td style="padding:14px 10px;text-align:center;vertical-align:top;">
            <span style="background:#7c3aed;color:white;border-radius:12px;padding:4px 12px;font-weight:bold;font-size:13px;">
              Fit {fit}
            </span>
            <br/>
            <a href="{gem.get("url", "#")}"
               style="color:#16a34a;font-weight:600;font-size:12px;text-decoration:none;display:inline-block;margin-top:8px;">
              View listing →
            </a>
          </td>
        </tr>
        """

    return f"""
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#111827;">
      <h1 style="color:#15803d;margin-bottom:4px;">🌾 Homestead Gems</h1>
      <p style="color:#6b7280;margin-top:0;font-size:13px;">
        {len(gems)} new listing{"s" if len(gems) != 1 else ""} pass the homestead filters
        (≥5 acres, ≤$500k, not in floodplain, soil class ≤6) AND score
        Fit ≥ {GEM_MIN_HOMESTEAD_FIT} with Deal ≥ {GEM_MIN_DEAL_SCORE}.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tbody>
          {rows}
        </tbody>
      </table>

      <p style="margin-top:24px;font-size:12px;color:#9ca3af;">
        Sent by Homestead Finder. Open the dashboard's
        <a href="https://cloudcodetree.com/homestead-finder/" style="color:#16a34a;">Deals</a>
        tab for the full curated list + filter funnel.
      </p>
    </body>
    </html>
    """
