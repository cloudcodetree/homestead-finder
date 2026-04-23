"""Tests for the discovery pipeline modules.

Each module is tested at the unit level against synthetic inputs —
we don't hit DuckDuckGo or any real network in tests. End-to-end
smoke happens manually via `python -m discovery.run`.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from discovery import discover, probe, rank, scaffold


# ── discover.py ────────────────────────────────────────────────────


def test_expand_queries_substitutes_state_and_region(tmp_path):
    seeds = {
        "states": [
            {"code": "MO", "name": "Missouri"},
            {"code": "AR", "name": "Arkansas"},
        ],
        "regions": ["Ozarks", "Delta"],
        "fsbo_queries": ["fsbo {state_name}"],
        "local_queries": ["broker {state_name} {region}"],
    }
    queries = discover.expand_queries(seeds)
    # 2 states × 1 template + 2 states × 2 regions × 1 template = 6
    assert "fsbo Missouri" in queries
    assert "fsbo Arkansas" in queries
    assert "broker Missouri Ozarks" in queries
    assert "broker Arkansas Delta" in queries
    assert len(queries) == 6


def test_blocklist_matches_subdomains():
    assert discover._in_blocklist("www.landwatch.com", ["landwatch.com"])
    assert discover._in_blocklist("foo.bar.landwatch.com", ["landwatch.com"])
    assert not discover._in_blocklist("notlandwatch.com", ["landwatch.com"])


def test_decode_ddg_redirect():
    # DDG: //duckduckgo.com/l/?uddg=<urlencoded target>&rut=...
    assert (
        discover._decode_ddg_redirect(
            "//duckduckgo.com/l/?uddg=https%3A%2F%2Fmyfarm.com%2Flistings&rut=abc"
        )
        == "https://myfarm.com/listings"
    )


def test_host_strips_www():
    assert discover._host("https://www.example.com/path") == "example.com"
    assert discover._host("https://sub.example.com/path") == "sub.example.com"


# ── probe.py ───────────────────────────────────────────────────────


def test_classify_render_next_js():
    body = '<html><head></head><body><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>'
    kind, walls = probe._classify_render(body)
    assert kind == "next.js_ssr"
    assert walls == []


def test_classify_render_cloudflare_wall():
    body = '<html>Checking your browser before accessing... | Ray ID: 12345 | Cloudflare</html>'
    kind, walls = probe._classify_render(body)
    assert "cloudflare" in walls


def test_classify_render_server_cards():
    body = '<div class="property-card" data-listing-id="1">Cabin</div>'
    kind, walls = probe._classify_render(body)
    assert kind == "server_rendered_cards"


def test_classify_render_react_spa():
    body = '<div id="root"></div><noscript>You need to enable JavaScript to run this app</noscript>'
    kind, _ = probe._classify_render(body)
    assert kind == "react_spa"


def test_count_sitemap_filters_listing_urls():
    xml = """
    <urlset>
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://example.com/property/123</loc></url>
      <url><loc>https://example.com/listing/abc-missouri-456</loc></url>
      <url><loc>https://example.com/land-for-sale/mo/forest</loc></url>
    </urlset>
    """
    total, listings, states = probe._count_sitemap(xml)
    assert total == 5
    assert listings == 3
    assert states == 2  # "missouri" and "/mo/"


# ── rank.py ────────────────────────────────────────────────────────


def _report(**overrides):
    base = probe.ProbeReport(
        domain="test.example",
        homepage_url="https://test.example/",
        homepage_status=200,
        homepage_bytes=50_000,
        render_type="server_rendered_cards",
        walls=[],
        robots_allowed=True,
        sitemap_listing_urls=0,
        sitemap_state_matches=0,
    )
    for k, v in overrides.items():
        setattr(base, k, v)
    return base


def test_rank_prefers_state_matches_over_generic_listings():
    a = _report(domain="a.example", sitemap_state_matches=100, sitemap_listing_urls=100)
    b = _report(domain="b.example", sitemap_state_matches=0, sitemap_listing_urls=200)
    ranked = rank.rank([a, b])
    assert ranked[0].domain == "a.example"


def test_rank_zeroes_captcha_walled():
    r = _report(walls=["captcha"], sitemap_state_matches=500)
    scored = rank.score_one(r)
    assert scored.score == 0


def test_rank_zeroes_robots_disallowed():
    r = _report(robots_allowed=False, sitemap_state_matches=500)
    scored = rank.score_one(r)
    assert scored.score == 0


def test_rank_gives_ssr_a_floor_when_no_sitemap_signal():
    """next.js SSR with no sitemap evidence still ranks > unknown."""
    ssr = _report(domain="ssr.example", render_type="next.js_ssr")
    unk = _report(domain="unk.example", render_type="unknown")
    ranked = rank.rank([ssr, unk])
    assert ranked[0].domain == "ssr.example"


def test_to_issue_markdown_limits_rows():
    reports = [
        _report(domain=f"site{i}.example", sitemap_state_matches=100 - i)
        for i in range(30)
    ]
    md = rank.to_issue_markdown(rank.rank(reports), limit=5)
    # Exactly 5 data rows + header + separator
    data_lines = [ln for ln in md.split("\n") if ln.startswith("|") and "---" not in ln]
    assert len(data_lines) == 6  # header + 5 data


# ── scaffold.py ────────────────────────────────────────────────────


def test_slugify_strips_tld_and_special_chars():
    assert scaffold._slugify("MyFarms.com") == "myfarms"
    assert scaffold._slugify("www.eureka-land.co.uk") == "eureka_land"
    assert scaffold._slugify("rural-3.biz") == "rural_3"


def test_class_name_capitalizes_parts():
    assert scaffold._class_name("myfarms") == "MyfarmsScraper"
    assert scaffold._class_name("eureka_land") == "EurekaLandScraper"


def test_write_source_next_js_includes_next_data_scaffold(tmp_path):
    path = scaffold.write_source(
        "myfarm.com", "next.js_ssr", overwrite=False, out_dir=tmp_path
    )
    body = path.read_text()
    assert "__NEXT_DATA__" in body
    assert "class MyfarmScraper" in body
    assert "SOURCE_NAME = \"myfarm\"" in body


def test_write_source_refuses_overwrite(tmp_path):
    scaffold.write_source("dup.com", "server_rendered_cards", out_dir=tmp_path)
    with pytest.raises(FileExistsError):
        scaffold.write_source("dup.com", "server_rendered_cards", out_dir=tmp_path)


def test_write_source_server_rendered_uses_bs4_scaffold(tmp_path):
    path = scaffold.write_source(
        "cards.com", "server_rendered_cards", out_dir=tmp_path
    )
    body = path.read_text()
    assert "BeautifulSoup" in body
    assert "soup.select" in body


# ── seeds.yml sanity ───────────────────────────────────────────────


def test_seeds_yml_parses_and_has_blocklist():
    root = Path(__file__).resolve().parents[1]
    seeds = discover.load_seeds(root / "discovery" / "seeds.yml")
    assert seeds.get("states")
    assert seeds.get("blocklist")
    assert "landwatch.com" in seeds["blocklist"]
