"""Listing-row schema versioning + migration chain.

Every listing dict carries `_schemaVersion: int`. On load, `migrate()`
walks the row forward through any pending migrations until it matches
`CURRENT_VERSION`. Migrations are pure functions — they take a row
dict and return a row dict; never raise on missing optional fields,
never mutate input.

This module ships with v1 = current shape and an empty migration
chain. The framework is in place so that the FIRST time we need to
rename, restructure, or namespace a field, we just add a new
migration function and bump `CURRENT_VERSION`. No coordinated
multi-component update.

Usage:

    from schema_migrate import migrate, stamp, CURRENT_VERSION

    # Stamp a fresh row from a scraper:
    listing = stamp(listing)

    # Walk an existing row forward (idempotent — no-op if already
    # at CURRENT_VERSION):
    listing = migrate(listing)

Design principles:
  * **Additive over breaking.** Prefer adding a new field over
    renaming. When we MUST rename, keep both fields populated for at
    least one schema version so consumers can transition.
  * **Pure functions.** Migrations don't I/O. They don't talk to
    Supabase, the AI pipeline, or the network. Pure dict-in /
    dict-out so they're trivially testable.
  * **Forward-only.** No down-migrations; once a row goes to v2 we
    don't roll back. Backups + raw-data preservation cover the
    "oh no" case.
"""

from __future__ import annotations

from typing import Any, Callable

# Bump this when adding a new migration. Every listing on load gets
# walked from its stored _schemaVersion up to this number.
CURRENT_VERSION = 1


# Type alias for clarity — each migration is `(row_in_at_vN) -> row_at_vN+1`.
Migration = Callable[[dict[str, Any]], dict[str, Any]]


# ── Migration chain ────────────────────────────────────────────────
# To add a new migration:
#   1. Bump CURRENT_VERSION above
#   2. Define a function `_migrate_v{N-1}_to_v{N}` below
#   3. Append to MIGRATIONS in version order
#
# Each function MUST handle missing optional fields gracefully — older
# rows may not have whatever the migration is operating on.

MIGRATIONS: list[Migration] = [
    # No migrations yet — v1 is current.
]


# ── Public API ────────────────────────────────────────────────────


def stamp(listing: dict[str, Any]) -> dict[str, Any]:
    """Add or refresh `_schemaVersion = CURRENT_VERSION` on a fresh row.

    Used by scrapers + main.py merge logic when emitting a row. Idempotent
    — calling on an already-stamped row is a no-op aside from forcing
    the version forward (which is correct: the row was just produced by
    code that knows the current shape)."""
    out = dict(listing)
    out["_schemaVersion"] = CURRENT_VERSION
    return out


def migrate(listing: dict[str, Any]) -> dict[str, Any]:
    """Walk `listing` forward to CURRENT_VERSION.

    Rows missing `_schemaVersion` are treated as v1 (the version when
    we introduced this module — historical rows predate it but are
    structurally compatible).
    """
    current = int(listing.get("_schemaVersion", 1))
    if current >= CURRENT_VERSION:
        # Already current; just stamp in case the field is missing.
        out = dict(listing)
        out["_schemaVersion"] = CURRENT_VERSION
        return out
    out = dict(listing)
    for i in range(current, CURRENT_VERSION):
        # MIGRATIONS[0] is v1→v2, MIGRATIONS[1] is v2→v3, etc.
        out = MIGRATIONS[i - 1](out)
        out["_schemaVersion"] = i + 1
    return out


def migrate_corpus(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Migrate a whole listings.json. Returns (new_rows, count_changed).

    Cheap when no migrations exist — every row no-ops. When migrations
    DO exist, this is where the corpus-wide upgrade happens (typically
    in main.py during the merge step).
    """
    out: list[dict[str, Any]] = []
    changed = 0
    for row in rows:
        before = row.get("_schemaVersion")
        migrated = migrate(row)
        if migrated.get("_schemaVersion") != before:
            changed += 1
        out.append(migrated)
    return out, changed
