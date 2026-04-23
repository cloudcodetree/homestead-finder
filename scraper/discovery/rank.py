"""Stage 3: rank probed candidates by expected value.

The ranking function is deliberately dumb — we're not trying to
decide "is this site good" from a distance, we're trying to surface
the best human-review candidates. The two inputs that matter:

  1. **Inventory estimate** — prefer sitemap_state_matches (MO/AR
     land URLs specifically). Fall back to sitemap_listing_urls if
     no state slugs detected. Last resort: render_type alone (we
     can still tell next.js SSR is probably scrapeable).

  2. **Accessibility score** — how expensive is it to actually
     scrape? Cheap HTTP beats Playwright beats login-walled.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from .probe import ProbeReport

_ACCESSIBILITY = {
    "next.js_ssr": 1.0,           # full JSON in page source — easiest
    "server_rendered_cards": 0.85, # plain BS4 scrape
    "jsonld_places": 0.75,         # parseable but may be incomplete
    "react_spa": 0.25,             # needs Playwright
    "unknown": 0.35,               # hedge — render detection missed
}

_WALL_PENALTY = {
    "cloudflare": 0.5,   # curl_cffi handles many CF walls
    "captcha": 0.0,      # hard block
    "login_wall": 0.0,   # hard block
}


@dataclass
class RankedCandidate:
    """Ranked output row. `reason` is a short human-readable
    explanation of how the score broke down — goes into the GitHub
    issue body so a human can decide at a glance."""

    domain: str
    score: float
    inventory_estimate: int
    render_type: str
    walls: list[str]
    reason: str
    raw: dict[str, Any]


def score_one(report: ProbeReport) -> RankedCandidate:
    inv = report.sitemap_state_matches or int(
        report.sitemap_listing_urls * 0.05
    )  # assume ~5% of a national sitemap is in-state when no slug match

    # No sitemap signal at all — give render_type a small floor so we
    # still rank this above walled sites.
    if inv == 0 and report.render_type in ("next.js_ssr", "server_rendered_cards"):
        inv = 25  # "probably has at least a couple dozen, worth probing further"

    access = _ACCESSIBILITY.get(report.render_type, 0.35)

    # Walls multiply accessibility (captcha/login = 0 → whole score zero)
    wall_factor = 1.0
    for w in report.walls:
        wall_factor *= _WALL_PENALTY.get(w, 0.5)

    if not report.robots_allowed:
        wall_factor = 0.0

    score = inv * access * wall_factor

    reason_bits = [
        f"inv≈{inv}",
        f"render={report.render_type}",
    ]
    if report.walls:
        reason_bits.append(f"walls={'+'.join(report.walls)}")
    if not report.robots_allowed:
        reason_bits.append("robots=DENY")
    if report.sitemap_state_matches:
        reason_bits.append(f"state-hits={report.sitemap_state_matches}")
    elif report.sitemap_listing_urls:
        reason_bits.append(f"listing-hits={report.sitemap_listing_urls}")

    return RankedCandidate(
        domain=report.domain,
        score=round(score, 2),
        inventory_estimate=inv,
        render_type=report.render_type,
        walls=report.walls,
        reason=" | ".join(reason_bits),
        raw=report.to_dict(),
    )


def rank(reports: list[ProbeReport]) -> list[RankedCandidate]:
    """Score every report and return sorted desc."""
    ranked = [score_one(r) for r in reports]
    ranked.sort(key=lambda c: c.score, reverse=True)
    return ranked


def to_issue_markdown(ranked: list[RankedCandidate], limit: int = 20) -> str:
    """Render the top-N as a Markdown table suitable for a GitHub
    issue body."""
    top = ranked[:limit]
    lines = [
        "# Candidate source review",
        "",
        f"Top {len(top)} of {len(ranked)} candidates from this week's discovery run.",
        "",
        "| Score | Domain | Inventory | Render | Walls | Reason |",
        "|------:|--------|----------:|--------|-------|--------|",
    ]
    for c in top:
        walls = ",".join(c.walls) or "—"
        lines.append(
            f"| {c.score:.1f} | [{c.domain}](https://{c.domain}) | "
            f"{c.inventory_estimate} | {c.render_type} | {walls} | {c.reason} |"
        )
    lines.extend(
        [
            "",
            "## How to act",
            "",
            "1. Pick the highest-scored candidate and verify it in a browser.",
            "2. If it has real MO/AR land inventory, run "
            "`python -m discovery.scaffold <domain>` to generate a starter "
            "scraper module.",
            "3. Finish the `parse()` method by hand, register in `main.py`, "
            "enable in `config.ENABLED_SOURCES`.",
            "4. If a candidate is definitively not useful, add its domain to "
            "`scraper/discovery/seeds.yml` under `blocklist:` so we don't "
            "re-probe it next week.",
        ]
    )
    return "\n".join(lines)


def to_dict_list(ranked: list[RankedCandidate]) -> list[dict[str, Any]]:
    """JSON-friendly serialization for the candidates_{date}.json
    artifact."""
    return [asdict(c) for c in ranked]
