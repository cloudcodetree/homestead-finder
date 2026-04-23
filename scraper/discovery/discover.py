"""Stage 1: expand seed queries and collect candidate domains via
DuckDuckGo's HTML endpoint (no API key, no rate-limit headers to
respect beyond the throttle module's generic one).

Why DuckDuckGo — Google's HTML SERP is aggressively bot-walled and
the paid API is $5/1k queries. DDG's `html.duckduckgo.com/html/`
endpoint is a plain form-submit that returns server-rendered result
cards, and the site tolerates ~1req/2s without complaint. We cap
results at 20/query which is enough for discovery purposes.
"""

from __future__ import annotations

import html
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import yaml  # PyYAML — already in requirements

import throttle
from logger import get_logger

log = get_logger("scraper.discovery.discover")

_DDG_URL = "https://html.duckduckgo.com/html/"
_MAX_RESULTS_PER_QUERY = 20


@dataclass(frozen=True)
class Candidate:
    """One row of search output. `first_seen_query` lets us trace
    which seed surfaced the domain."""

    domain: str
    url: str
    title: str
    snippet: str
    first_seen_query: str


def load_seeds(path: Path) -> dict:
    """Parse seeds.yml. Returns the full dict; callers pick the
    sections they need (states / regions / queries / blocklist)."""
    with open(path) as f:
        return yaml.safe_load(f)


def expand_queries(seeds: dict) -> list[str]:
    """Cross-render every `{state_name}` / `{region}` placeholder in
    the four query buckets. Returns a deduplicated flat list of
    concrete search strings."""
    states = seeds.get("states", [])
    regions = seeds.get("regions", [""])
    buckets = (
        seeds.get("fsbo_queries", [])
        + seeds.get("local_queries", [])
        + seeds.get("government_queries", [])
        + seeds.get("auction_queries", [])
    )
    queries: set[str] = set()
    for template in buckets:
        needs_state = "{state_name}" in template or "{state}" in template
        needs_region = "{region}" in template
        state_options = states if needs_state else [None]
        region_options = regions if needs_region else [None]
        for s in state_options:
            for r in region_options:
                q = template
                if s is not None:
                    q = q.replace("{state_name}", s["name"])
                    q = q.replace("{state}", s["code"])
                if r is not None:
                    q = q.replace("{region}", r)
                queries.add(q)
    return sorted(queries)


# DDG's HTML output wraps each result in
#   <a class="result__a" href="//duckduckgo.com/l/?uddg=<encoded>&...">title</a>
# The redirect URL decodes back to the actual target via `uddg` param.
# Snippets live in `.result__snippet`.
_A_TAG_RE = re.compile(
    r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)</a>',
    re.DOTALL,
)
_SNIPPET_RE = re.compile(
    r'<a class="result__snippet"[^>]*>(.*?)</a>',
    re.DOTALL,
)


def _decode_ddg_redirect(redirect: str) -> str:
    """DDG wraps result links in /l/?uddg=<urlencoded-target>&… — unwrap."""
    if redirect.startswith("//"):
        redirect = "https:" + redirect
    parsed = urllib.parse.urlparse(redirect)
    qs = urllib.parse.parse_qs(parsed.query)
    target = qs.get("uddg", [""])[0]
    if target:
        return urllib.parse.unquote(target)
    return redirect


def _strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def _host(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    host = (p.hostname or "").lower()
    # Normalize www.* → * so blocklist matches work
    return host[4:] if host.startswith("www.") else host


def search(query: str) -> list[Candidate]:
    """Submit one query to DDG HTML and parse the results. Rides on
    the shared throttle layer so we never hammer DDG."""
    import requests

    throttle.acquire(_DDG_URL)
    status = None
    try:
        r = requests.post(
            _DDG_URL,
            data={"q": query},
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml",
            },
            timeout=15,
        )
        status = r.status_code
        r.raise_for_status()
        html_text = r.text
    except Exception as e:  # noqa: BLE001
        log.info(f"[discover] DDG query failed: {query!r}: {e}")
        return []
    finally:
        throttle.release(_DDG_URL, status)

    anchors = _A_TAG_RE.findall(html_text)
    snippets = _SNIPPET_RE.findall(html_text)
    results: list[Candidate] = []
    for i, (href, title_html) in enumerate(anchors[:_MAX_RESULTS_PER_QUERY]):
        url = _decode_ddg_redirect(href)
        if not url.startswith("http"):
            continue
        title = _strip_tags(title_html)
        snippet = _strip_tags(snippets[i]) if i < len(snippets) else ""
        results.append(
            Candidate(
                domain=_host(url),
                url=url,
                title=title,
                snippet=snippet,
                first_seen_query=query,
            )
        )
    return results


def _in_blocklist(domain: str, blocklist: Iterable[str]) -> bool:
    """Blocklist entries match as domain OR parent-domain suffix."""
    for bad in blocklist:
        bad = bad.lower()
        if domain == bad or domain.endswith("." + bad):
            return True
    return False


def run_discovery(seeds_path: Path) -> list[Candidate]:
    """Run every expanded query, dedupe by domain, filter blocklist.

    Returns one Candidate per unique domain — the first occurrence
    wins (its query is recorded as `first_seen_query`).
    """
    seeds = load_seeds(seeds_path)
    blocklist = set(seeds.get("blocklist", []))
    queries = expand_queries(seeds)
    log.info(f"[discover] {len(queries)} expanded queries")

    by_domain: dict[str, Candidate] = {}
    for i, q in enumerate(queries, 1):
        hits = search(q)
        for c in hits:
            if not c.domain:
                continue
            if _in_blocklist(c.domain, blocklist):
                continue
            if c.domain not in by_domain:
                by_domain[c.domain] = c
        if i % 10 == 0:
            log.info(
                f"[discover] {i}/{len(queries)} queries done, "
                f"{len(by_domain)} unique domains so far"
            )

    log.info(f"[discover] final: {len(by_domain)} candidate domains")
    return list(by_domain.values())
