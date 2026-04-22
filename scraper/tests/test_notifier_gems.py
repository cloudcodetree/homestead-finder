"""Tests for the homestead-gem filter + alert pipeline in notifier.py."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import notifier


def _gem_candidate(**overrides):
    base = {
        "id": "landwatch_good_1",
        "status": None,
        "price": 150_000,
        "acreage": 20,
        "dealScore": 70,
        "homesteadFitScore": 78,
        "aiTags": ["year_round_water", "build_ready"],
        "features": ["water_creek"],
        "redFlags": [],
        "source": "landwatch",
        "location": {"state": "WY", "county": "Park"},
        "geoEnrichment": {
            "flood": {"floodZone": "X", "isSFHA": False},
            "soil": {"capabilityClass": "3"},
        },
    }
    base.update(overrides)
    return base


# ── filter_homestead_gems ─────────────────────────────────────────────────


def test_filter_accepts_good_candidate():
    out = notifier.filter_homestead_gems([_gem_candidate()])
    assert len(out) == 1


def test_filter_rejects_low_fit_score():
    out = notifier.filter_homestead_gems([_gem_candidate(homesteadFitScore=65)])
    assert out == []


def test_filter_rejects_missing_fit_score():
    # Unenriched listings can't be graded as gems
    out = notifier.filter_homestead_gems([_gem_candidate(homesteadFitScore=None)])
    assert out == []


def test_filter_rejects_low_deal_score():
    out = notifier.filter_homestead_gems([_gem_candidate(dealScore=40)])
    assert out == []


def test_filter_rejects_tax_sale_rows():
    # Tax sales have their own diligence pipeline
    out = notifier.filter_homestead_gems([_gem_candidate(status="tax_sale")])
    assert out == []


def test_filter_rejects_floodplain():
    bad = _gem_candidate()
    bad["geoEnrichment"]["flood"]["floodZone"] = "AE"
    bad["geoEnrichment"]["flood"]["isSFHA"] = True
    assert notifier.filter_homestead_gems([bad]) == []


def test_filter_skips_previously_seen():
    seen = {"landwatch_good_1"}
    out = notifier.filter_homestead_gems([_gem_candidate()], previously_seen=seen)
    assert out == []


def test_filter_sorts_best_first():
    weak = _gem_candidate(id="weak", homesteadFitScore=71, dealScore=61)
    strong = _gem_candidate(id="strong", homesteadFitScore=90, dealScore=85)
    mid = _gem_candidate(id="mid", homesteadFitScore=80, dealScore=72)
    out = notifier.filter_homestead_gems([weak, strong, mid])
    assert [g["id"] for g in out] == ["strong", "mid", "weak"]


# ── send_homestead_gems_alert ─────────────────────────────────────────────


def test_alert_skips_gracefully_without_sendgrid(monkeypatch, capsys):
    monkeypatch.setattr(notifier, "SENDGRID_API_KEY", "")
    monkeypatch.setattr(notifier, "NOTIFICATION_EMAIL", "")
    ok = notifier.send_homestead_gems_alert([_gem_candidate()])
    assert ok is False  # documented: unset creds → no alert, not an error
    captured = capsys.readouterr()
    assert "SendGrid not configured" in captured.out


def test_alert_returns_true_on_empty_gem_list(monkeypatch):
    monkeypatch.setattr(notifier, "SENDGRID_API_KEY", "k")
    monkeypatch.setattr(notifier, "NOTIFICATION_EMAIL", "x@y.z")
    assert notifier.send_homestead_gems_alert([]) is True


def test_alert_sends_via_sendgrid_when_configured(monkeypatch):
    monkeypatch.setattr(notifier, "SENDGRID_API_KEY", "k")
    monkeypatch.setattr(notifier, "NOTIFICATION_EMAIL", "x@y.z")
    fake_response = MagicMock(status_code=202)
    fake_client = MagicMock()
    fake_client.client.mail.send.post.return_value = fake_response
    with patch.object(notifier, "sendgrid") as sg_mod:
        sg_mod.SendGridAPIClient.return_value = fake_client
        ok = notifier.send_homestead_gems_alert([_gem_candidate()])
    assert ok is True
    # Confirm we rendered a Mail payload via sendgrid helpers
    fake_client.client.mail.send.post.assert_called_once()


def test_alert_swallows_sendgrid_exceptions(monkeypatch, capsys):
    monkeypatch.setattr(notifier, "SENDGRID_API_KEY", "k")
    monkeypatch.setattr(notifier, "NOTIFICATION_EMAIL", "x@y.z")
    with patch.object(notifier, "sendgrid") as sg_mod:
        sg_mod.SendGridAPIClient.side_effect = RuntimeError("network down")
        ok = notifier.send_homestead_gems_alert([_gem_candidate()])
    assert ok is False
    captured = capsys.readouterr()
    assert "Failed to send" in captured.out


# ── _build_gem_email_body ─────────────────────────────────────────────────


def test_email_body_mentions_key_fields_for_every_gem():
    gems = [
        _gem_candidate(
            id=f"g_{i}",
            title=f"Gem {i}",
            price=100_000 + i * 1000,
            aiSummary="Custom AI summary here",
        )
        for i in range(3)
    ]
    body = notifier._build_gem_email_body(gems)
    for gem in gems:
        assert gem["title"] in body
    # aiSummary should appear in at least one row
    assert "Custom AI summary here" in body
    # Funnel header should reference both thresholds
    assert str(notifier.GEM_MIN_HOMESTEAD_FIT) in body
    assert str(notifier.GEM_MIN_DEAL_SCORE) in body


def test_email_body_caps_at_20_gems():
    gems = [_gem_candidate(id=f"g_{i}", title=f"Gem {i}") for i in range(30)]
    body = notifier._build_gem_email_body(gems)
    # Gem 20 should not appear (index 20 → 21st gem), Gem 19 should
    assert "Gem 19" in body
    assert "Gem 20" not in body
