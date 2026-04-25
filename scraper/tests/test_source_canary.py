"""Tests for source_canary — formatting, exit logic, source filtering.

Network calls are mocked; real HTTP not exercised.
"""

from __future__ import annotations

import source_canary as sc


def _result(source: str, ok: bool, status: int | None = 200, body: int = 50_000, notes: str = "") -> sc.CanaryResult:
    return sc.CanaryResult(
        source=source, url=f"https://{source}.example/", status=status,
        body_len=body, ok=ok, notes=notes,
    )


def test_format_report_with_failures():
    results = [
        _result("landwatch", False, 403, 200, "Cloudflare"),
        _result("landhub", True),
        _result("mossy_oak", False, None, 0, "ConnectionError"),
    ]
    report = sc.format_report(results)
    # Failures section comes first
    assert "❌ 2 source(s) failing" in report
    assert "✅ 1 source(s) healthy" in report
    # Both failures referenced
    assert "`landwatch`" in report
    assert "`mossy_oak`" in report
    # Healthy one is in the bottom table
    assert "`landhub`" in report


def test_format_report_all_healthy():
    results = [_result("a", True), _result("b", True)]
    report = sc.format_report(results)
    assert "❌" not in report  # no failure section
    assert "✅ 2 source(s) healthy" in report


def test_run_canary_skips_local_only_by_default(monkeypatch):
    """Critical: never wake up Cloudflare trackers from CI."""
    pinged: list[tuple[str, str]] = []

    def fake_ping(source, url, **kwargs):
        pinged.append((source, url))
        return _result(source, True)

    monkeypatch.setattr(sc, "ping_one", fake_ping)

    # Force a known config
    monkeypatch.setattr(
        sc.config, "ENABLED_SOURCES",
        {"landwatch": True, "landhub": True, "mossy_oak": True},
    )
    monkeypatch.setattr(sc.config, "LOCAL_ONLY_SOURCES", {"landwatch"})
    monkeypatch.setattr(
        sc, "CANARY_URLS",
        {
            "landwatch": "https://lw.example/",
            "landhub": "https://lh.example/",
            "mossy_oak": "https://mo.example/",
        },
    )

    results = sc.run_canary(include_local=False)
    sources_pinged = {s for s, _ in pinged}
    assert sources_pinged == {"landhub", "mossy_oak"}
    assert "landwatch" not in sources_pinged
    assert len(results) == 2


def test_run_canary_includes_local_when_asked(monkeypatch):
    pinged: list[str] = []
    monkeypatch.setattr(
        sc, "ping_one",
        lambda s, u, **k: (pinged.append(s) or _result(s, True)),
    )
    monkeypatch.setattr(
        sc.config, "ENABLED_SOURCES",
        {"landwatch": True, "landhub": True},
    )
    monkeypatch.setattr(sc.config, "LOCAL_ONLY_SOURCES", {"landwatch"})
    monkeypatch.setattr(
        sc, "CANARY_URLS",
        {"landwatch": "https://lw.example/", "landhub": "https://lh.example/"},
    )

    sc.run_canary(include_local=True)
    assert set(pinged) == {"landwatch", "landhub"}


def test_run_canary_skips_disabled(monkeypatch):
    pinged: list[str] = []
    monkeypatch.setattr(
        sc, "ping_one",
        lambda s, u, **k: (pinged.append(s) or _result(s, True)),
    )
    monkeypatch.setattr(
        sc.config, "ENABLED_SOURCES",
        {"landwatch": True, "zillow": False, "realtor": False, "landhub": True},
    )
    monkeypatch.setattr(sc.config, "LOCAL_ONLY_SOURCES", {"landwatch"})
    monkeypatch.setattr(
        sc, "CANARY_URLS",
        {
            "landwatch": "x", "zillow": "y", "realtor": "z", "landhub": "w",
        },
    )
    sc.run_canary()
    # Only enabled + non-local
    assert set(pinged) == {"landhub"}
