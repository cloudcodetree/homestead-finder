"""Learned selector management: load, save, validate, apply cached selectors."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from config import LEARNED_SELECTORS_DIR


def _selectors_path(source_name: str) -> Path:
    """Get the path to a source's learned selectors file."""
    return LEARNED_SELECTORS_DIR / f"{source_name}.json"


def load_selectors(source_name: str) -> dict[str, Any] | None:
    """Load learned selectors for a source. Returns None if not found."""
    path = _selectors_path(source_name)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def save_selectors(
    source_name: str,
    selectors: dict[str, str],
    field_extraction: dict[str, str],
    confidence: float,
    discovery_model: str,
) -> None:
    """Save newly discovered selectors for a source."""
    LEARNED_SELECTORS_DIR.mkdir(parents=True, exist_ok=True)

    existing = load_selectors(source_name)
    version = (existing.get("version", 0) + 1) if existing else 1
    now = datetime.now(timezone.utc).isoformat()

    data = {
        "source": source_name,
        "version": version,
        "created_at": existing.get("created_at", now) if existing else now,
        "updated_at": now,
        "last_validated": now,
        "validation_streak": 0,
        "selectors": selectors,
        "field_extraction": field_extraction,
        "confidence": confidence,
        "discovery_model": discovery_model,
    }

    _selectors_path(source_name).write_text(json.dumps(data, indent=2))
    print(
        f"  [ai] Saved learned selectors v{version} for {source_name} (confidence: {confidence:.2f})"
    )


def bump_validation(source_name: str) -> None:
    """Record a successful validation of learned selectors."""
    data = load_selectors(source_name)
    if data is None:
        return
    data["last_validated"] = datetime.now(timezone.utc).isoformat()
    data["validation_streak"] = data.get("validation_streak", 0) + 1
    _selectors_path(source_name).write_text(json.dumps(data, indent=2))


def apply_selectors(html: str, selector_config: dict[str, Any]) -> list[dict[str, Any]]:
    """Apply learned CSS selectors to HTML and extract listing data.

    Returns a list of dicts with keys: title, price, acreage, url, location, external_id.
    """
    soup = BeautifulSoup(html, "lxml")
    selectors = selector_config.get("selectors", {})
    extraction = selector_config.get("field_extraction", {})

    container_sel = selectors.get("listing_container", "")
    if not container_sel:
        return []

    cards = soup.select(container_sel)
    if not cards:
        return []

    price_re = re.compile(extraction.get("price_regex", r"[\d,]+\.?\d*"))
    acreage_re = re.compile(
        extraction.get("acreage_regex", r"([\d,]+\.?\d*)\s*acres?"), re.IGNORECASE
    )
    id_re = (
        re.compile(extraction.get("id_from_url_regex", r"/(\d+)/?$"))
        if extraction.get("id_from_url_regex")
        else None
    )

    results: list[dict[str, Any]] = []
    for card in cards:
        try:
            # Title
            title_el = (
                card.select_one(selectors.get("title", ""))
                if selectors.get("title")
                else None
            )
            title = title_el.get_text(strip=True) if title_el else ""

            # Price
            price_el = (
                card.select_one(selectors.get("price", ""))
                if selectors.get("price")
                else None
            )
            price_text = price_el.get_text(strip=True) if price_el else ""
            price_match = (
                price_re.search(price_text.replace(",", "")) if price_text else None
            )
            price = float(price_match.group(0)) if price_match else 0.0

            # Acreage
            acreage_el = (
                card.select_one(selectors.get("acreage", ""))
                if selectors.get("acreage")
                else None
            )
            acreage_text = (
                acreage_el.get_text(strip=True) if acreage_el else card.get_text()
            )
            acreage_match = acreage_re.search(acreage_text) if acreage_text else None
            acreage = (
                float(acreage_match.group(1).replace(",", "")) if acreage_match else 0.0
            )

            # URL
            link_el = (
                card.select_one(selectors.get("link", "a[href]"))
                if selectors.get("link")
                else card.select_one("a[href]")
            )
            url = link_el.get("href", "") if link_el else ""

            # Location
            location_el = (
                card.select_one(selectors.get("location", ""))
                if selectors.get("location")
                else None
            )
            location = location_el.get_text(strip=True) if location_el else ""

            # External ID from URL
            external_id = ""
            if id_re and url:
                id_match = id_re.search(str(url))
                external_id = id_match.group(1) if id_match else ""

            if title and (price > 0 or acreage > 0):
                results.append(
                    {
                        "title": title,
                        "price": price,
                        "acreage": acreage,
                        "url": str(url),
                        "location": location,
                        "external_id": external_id,
                    }
                )
        except Exception:
            continue

    return results
