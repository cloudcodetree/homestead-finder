"""Move data between `data/listings.json` and `data/corpus.sqlite`.

JSON is the artifact the static frontend consumes. SQLite is the
scraper's working store. These two helpers keep them in sync during
the migration:

  * `import_from_json(path)` — load listings.json into the DB,
    upsert by id. Idempotent — safe to re-run after every scrape.
  * `export_to_json(path)` — emit the DB contents back as listings.json
    so the frontend keeps reading from the same path it always has.

CLI:
    python -m scraper.db_io import        # JSON → DB
    python -m scraper.db_io export        # DB → JSON
    python -m scraper.db_io stats         # quick sanity / health peek
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import config
import db
from logger import get_logger

log = get_logger("db_io")


def import_from_json(json_path: Path = config.DATA_DIR / "listings.json") -> int:
    """Bulk-upsert every listing from the JSON file into the SQLite
    DB. Returns the count of rows written."""
    if not json_path.exists():
        log.info(f"[db_io] no JSON at {json_path}; nothing to import")
        return 0
    rows = json.loads(json_path.read_text())
    if not isinstance(rows, list):
        raise ValueError(f"{json_path} is not a JSON list")
    with db.connect() as conn:
        n = db.upsert_many(conn, rows)
    log.info(f"[db_io] imported {n}/{len(rows)} listings from {json_path}")
    return n


def export_to_json(json_path: Path = config.DATA_DIR / "listings.json") -> int:
    """Write every row in the DB back to listings.json. Used to keep
    the static frontend's data file in sync after passes mutate the
    DB rather than the JSON.

    Sort by id for stable git diffs — the JSON is checked into the
    repo (per the static-site deploy model)."""
    with db.connect() as conn:
        rows = db.all_listings(conn)
    rows.sort(key=lambda r: r.get("id") or "")
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(rows, indent=2))
    log.info(f"[db_io] exported {len(rows)} listings → {json_path}")
    return len(rows)


def stats() -> dict[str, int]:
    """Quick counts the operator can sanity-check without firing up
    sqlite3 themselves. Mirrors what `health_check.py` would compute
    for a single source-agnostic snapshot."""
    with db.connect() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM listings").fetchone()["n"]
        by_source = {
            r["source"]: r["n"]
            for r in conn.execute(
                "SELECT source, COUNT(*) AS n FROM listings GROUP BY source ORDER BY n DESC"
            )
        }
        with_geo = conn.execute(
            "SELECT COUNT(*) AS n FROM listings WHERE lat IS NOT NULL AND lat != 0"
        ).fetchone()["n"]
        with_pass = {
            r["pass_name"]: r["n"]
            for r in conn.execute(
                "SELECT pass_name, COUNT(*) AS n FROM passes WHERE success = 1 GROUP BY pass_name"
            )
        }
    print(f"Total listings: {total}")
    print(f"With geo: {with_geo} ({with_geo / max(total, 1) * 100:.1f}%)")
    print("By source:")
    for s, n in by_source.items():
        print(f"  {s:<24} {n}")
    if with_pass:
        print("Pass coverage:")
        for p, n in with_pass.items():
            print(f"  {p:<24} {n}")
    return {"total": total, "with_geo": with_geo, **{f"src_{k}": v for k, v in by_source.items()}}


def main() -> None:
    parser = argparse.ArgumentParser(description="Move data between JSON and SQLite stores")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("import", help="Load listings.json into the DB")
    sub.add_parser("export", help="Write DB contents to listings.json")
    sub.add_parser("stats", help="Quick counts and per-source breakdown")
    args = parser.parse_args()
    if args.cmd == "import":
        import_from_json()
    elif args.cmd == "export":
        export_to_json()
    elif args.cmd == "stats":
        stats()
    else:
        parser.print_help()
        sys.exit(2)


if __name__ == "__main__":
    main()
