"""SQLite-backed corpus store.

The scraper has been growing a long chain of passes that each
read+rewrite `data/listings.json` (image_refresh, image_validation,
enrich, enrich_geo, curate, deals, health_check, …). Every pass pays
the full-corpus deserialize / re-serialize tax, and they don't
compose: a partial pipeline run leaves listings.json in a half-
written state. As corpus size approaches ~5k rows the JSON file
also becomes painful to diff in git and slow to load on the
frontend.

This module introduces a SQLite store as the scraper's primary
persistence layer. JSON stays the shipped artifact (the static
GitHub Pages frontend reads `data/listings.json` directly), but
all in-pipeline mutations route through SQL. Two helpers below
move data in and out:

  * `import_from_json(path)` — load listings.json into the DB
  * `export_to_json(path)` — write the DB out as listings.json

Schema choices
--------------
- One `listings` row per id. The ENTIRE listing payload is stored
  in a `data` JSON column (TEXT) so we don't have to migrate the
  schema every time a new field appears. Frequently-queried fields
  (source, state, county, dealScore, status) are denormalized into
  scalar columns + indexed for fast filtering.
- A `passes` table records which scraper pass last touched each
  row (image_refresh, enrich_geo, etc.) and when. Lets future
  passes skip rows they've already enriched without scanning the
  payload.
- `schema_version` matches the existing `_schemaVersion` field in
  the JSON so `schema_migrate.py` can run against either store.

This is a SHADOW store — JSON remains canonical until passes have
been migrated one at a time. `db_io.import_from_json` is therefore
idempotent and can be re-run safely whenever the JSON wins a tie.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

import config
from logger import get_logger

log = get_logger("db")

DB_PATH = config.DATA_DIR / "corpus.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    state       TEXT,
    county      TEXT,
    status      TEXT,
    deal_score  REAL,
    price_usd   REAL,
    acreage     REAL,
    lat         REAL,
    lng         REAL,
    url         TEXT,
    -- Full row payload as JSON. Denormalized scalars above are
    -- maintained on every upsert. Source of truth for fields not
    -- pulled into columns.
    data        TEXT NOT NULL,
    schema_ver  TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_source ON listings (source);
CREATE INDEX IF NOT EXISTS idx_listings_state ON listings (state);
CREATE INDEX IF NOT EXISTS idx_listings_county ON listings (state, county);
CREATE INDEX IF NOT EXISTS idx_listings_score ON listings (deal_score);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status);
CREATE INDEX IF NOT EXISTS idx_listings_url ON listings (url);

CREATE TABLE IF NOT EXISTS passes (
    listing_id  TEXT NOT NULL,
    pass_name   TEXT NOT NULL,
    ran_at      TEXT NOT NULL DEFAULT (datetime('now')),
    success     INTEGER NOT NULL DEFAULT 1,
    note        TEXT,
    PRIMARY KEY (listing_id, pass_name),
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_passes_pass ON passes (pass_name);

-- Lightweight key/value table for cross-cutting state we don't
-- want to scatter (last full scrape time, last health check,
-- pipeline schema version, …). Keep it simple — promote anything
-- that grows beyond ~1KB to its own table.
CREATE TABLE IF NOT EXISTS meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


@contextmanager
def connect(path: Path = DB_PATH) -> Iterator[sqlite3.Connection]:
    """Open a sqlite3 connection with the project's defaults.

    Pragmas:
      - WAL mode → readers don't block writers, fine for our
        single-writer scraper + occasional read-only inspections.
      - foreign_keys=ON → the `passes` cascade delete actually fires.
      - busy_timeout=5000ms → tolerate brief contention if a pass and
        an interactive query happen to overlap.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.executescript(_SCHEMA)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _denorm_columns(row: dict[str, Any]) -> dict[str, Any]:
    """Pull the fields we promote to scalar columns out of the
    listing dict. Every field is optional — older rows produced
    before a particular field existed land as NULL."""
    loc = row.get("location") or {}
    return {
        "id": row.get("id") or "",
        "source": row.get("source") or "unknown",
        "state": loc.get("state"),
        "county": loc.get("county"),
        "status": row.get("status"),
        "deal_score": row.get("dealScore"),
        "price_usd": row.get("price"),
        "acreage": row.get("acreage"),
        "lat": loc.get("lat"),
        "lng": loc.get("lng"),
        "url": row.get("url"),
        "schema_ver": row.get("_schemaVersion"),
    }


def upsert_listing(conn: sqlite3.Connection, row: dict[str, Any]) -> None:
    """Insert or replace a single listing. Caller is responsible for
    transaction batching when bulk-loading."""
    if not row.get("id"):
        return
    cols = _denorm_columns(row)
    cols["data"] = json.dumps(row, separators=(",", ":"))
    conn.execute(
        """
        INSERT INTO listings (
            id, source, state, county, status, deal_score, price_usd,
            acreage, lat, lng, url, data, schema_ver, updated_at
        ) VALUES (
            :id, :source, :state, :county, :status, :deal_score,
            :price_usd, :acreage, :lat, :lng, :url, :data, :schema_ver,
            datetime('now')
        )
        ON CONFLICT(id) DO UPDATE SET
            source = excluded.source,
            state = excluded.state,
            county = excluded.county,
            status = excluded.status,
            deal_score = excluded.deal_score,
            price_usd = excluded.price_usd,
            acreage = excluded.acreage,
            lat = excluded.lat,
            lng = excluded.lng,
            url = excluded.url,
            data = excluded.data,
            schema_ver = excluded.schema_ver,
            updated_at = datetime('now')
        """,
        cols,
    )


def upsert_many(conn: sqlite3.Connection, rows: Iterable[dict[str, Any]]) -> int:
    """Bulk-upsert in a single transaction. Returns count written."""
    n = 0
    for row in rows:
        if not row.get("id"):
            continue
        upsert_listing(conn, row)
        n += 1
    return n


def get_listing(conn: sqlite3.Connection, listing_id: str) -> dict[str, Any] | None:
    cur = conn.execute("SELECT data FROM listings WHERE id = ?", (listing_id,))
    r = cur.fetchone()
    return json.loads(r["data"]) if r else None


def all_listings(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return every listing row as the caller's familiar dict shape.

    Use this for export-to-JSON; for filtered queries (e.g. all
    LandWatch rows in MO) prefer `query_listings()` so you don't
    deserialize 1000+ payloads into memory just to filter them out.
    """
    cur = conn.execute("SELECT data FROM listings")
    return [json.loads(r["data"]) for r in cur.fetchall()]


def query_listings(
    conn: sqlite3.Connection,
    *,
    source: str | None = None,
    state: str | None = None,
    needs_pass: str | None = None,
) -> list[dict[str, Any]]:
    """Return listings matching the filters.

    `needs_pass='image_refresh'` returns rows that have NOT yet had
    image_refresh marked successful — uses an anti-join against the
    passes table so re-running a pass naturally skips already-done
    work. Replaces the bespoke `_needs_refresh` heuristics scattered
    across pass modules.
    """
    where = ["1=1"]
    params: list[Any] = []
    if source is not None:
        where.append("l.source = ?")
        params.append(source)
    if state is not None:
        where.append("l.state = ?")
        params.append(state)
    if needs_pass is not None:
        where.append(
            """
            NOT EXISTS (
                SELECT 1 FROM passes p
                WHERE p.listing_id = l.id
                  AND p.pass_name = ?
                  AND p.success = 1
            )
            """
        )
        params.append(needs_pass)
    sql = f"SELECT data FROM listings l WHERE {' AND '.join(where)}"
    cur = conn.execute(sql, params)
    return [json.loads(r["data"]) for r in cur.fetchall()]


def mark_pass(
    conn: sqlite3.Connection,
    listing_id: str,
    pass_name: str,
    *,
    success: bool = True,
    note: str | None = None,
) -> None:
    """Record that a scraper pass has run on a listing. Idempotent —
    re-marking updates the timestamp + status, so a re-run logs as
    the most recent attempt."""
    conn.execute(
        """
        INSERT INTO passes (listing_id, pass_name, ran_at, success, note)
        VALUES (?, ?, datetime('now'), ?, ?)
        ON CONFLICT(listing_id, pass_name) DO UPDATE SET
            ran_at = datetime('now'),
            success = excluded.success,
            note = excluded.note
        """,
        (listing_id, pass_name, 1 if success else 0, note),
    )


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
        """,
        (key, value),
    )


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    cur = conn.execute("SELECT value FROM meta WHERE key = ?", (key,))
    r = cur.fetchone()
    return r["value"] if r else None
