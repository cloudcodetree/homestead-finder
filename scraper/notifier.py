"""Email notification sender using SendGrid."""
from __future__ import annotations

from typing import Any

import sendgrid
from sendgrid.helpers.mail import Mail

from config import SENDGRID_API_KEY, NOTIFICATION_EMAIL, NOTIFICATION_SCORE_THRESHOLD
from scoring import ScoringEngine
from utils.formatters import format_price, format_acreage, format_price_per_acre


def send_deal_alert(hot_deals: list[dict[str, Any]]) -> bool:
    """Send email notification for hot deals. Returns True on success."""
    if not SENDGRID_API_KEY or not NOTIFICATION_EMAIL:
        print("  [notifier] No SendGrid API key or email configured — skipping notification")
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
            print(f"  [notifier] Alert sent for {len(hot_deals)} deals → {NOTIFICATION_EMAIL}")
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
        score_color = "#22c55e" if score >= 80 else "#eab308" if score >= 65 else "#f97316"

        rows += f"""
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:12px 8px;">
            <strong style="display:block;">{deal.get('title', 'Land Listing')}</strong>
            <span style="color:#6b7280;font-size:13px;">{county} County, {state}</span>
          </td>
          <td style="padding:12px 8px;text-align:right;">
            <strong>{format_price(deal.get('price', 0))}</strong><br>
            <span style="color:#6b7280;font-size:13px;">{format_price_per_acre(deal.get('pricePerAcre', 0))}</span>
          </td>
          <td style="padding:12px 8px;text-align:center;">
            {format_acreage(deal.get('acreage', 0))}
          </td>
          <td style="padding:12px 8px;text-align:center;">
            <span style="background:{score_color};color:white;border-radius:12px;padding:2px 10px;font-weight:bold;">
              {score}
            </span>
          </td>
          <td style="padding:12px 8px;text-align:center;">
            <a href="{deal.get('url', '#')}"
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
        {len(deals)} new deal{'s' if len(deals) > 1 else ''} with score ≥ {NOTIFICATION_SCORE_THRESHOLD}
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
        p for p in properties
        if p.get("dealScore", 0) >= threshold
        and p.get("id", "") not in previously_seen
    ]
