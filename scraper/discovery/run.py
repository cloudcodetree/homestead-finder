"""Discovery pipeline entry point: expand seeds → discover candidates
→ probe → rank → write artifacts.

Run:
    python -m discovery.run
    python -m discovery.run --seeds custom_seeds.yml --limit 10

Writes two artifacts to `data/discovery/`:
  * `candidates_{date}.json` — full ranked list with probe reports
  * `report_{date}.md`       — top-N Markdown table (issue-ready body)

Weekly CI wraps this and opens a GitHub issue with the Markdown body.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from logger import get_logger

from .discover import run_discovery
from .probe import ProbeReport, probe
from .rank import rank, to_dict_list, to_issue_markdown

log = get_logger("scraper.discovery.run")

_DEFAULT_SEEDS = Path(__file__).parent / "seeds.yml"


def _out_dir() -> Path:
    try:
        from config import DATA_DIR

        base = DATA_DIR / "discovery"
    except Exception:  # noqa: BLE001
        base = Path(__file__).parent.parent.parent / "data" / "discovery"
    base.mkdir(parents=True, exist_ok=True)
    return base


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="discovery.run")
    ap.add_argument("--seeds", type=Path, default=_DEFAULT_SEEDS)
    ap.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Top-N candidates rendered in the issue-ready Markdown.",
    )
    ap.add_argument(
        "--skip-probe",
        action="store_true",
        help="Run only the discovery stage (writes raw candidate list).",
    )
    ap.add_argument(
        "--max-candidates",
        type=int,
        default=60,
        help="Cap on candidates to probe (each probe does 2 HTTP requests).",
    )
    args = ap.parse_args(argv)

    log.info("=== Source discovery — stage 1: DDG search ===")
    candidates = run_discovery(args.seeds)
    print(f"Found {len(candidates)} unique candidate domains")

    out_dir = _out_dir()
    today = date.today().isoformat()

    if args.skip_probe:
        raw_path = out_dir / f"raw_candidates_{today}.json"
        raw_path.write_text(
            json.dumps([c.__dict__ for c in candidates], indent=2)
        )
        print(f"Wrote {raw_path}")
        return 0

    # Cap to avoid blowing the quota on a single run.
    to_probe = candidates[: args.max_candidates]
    log.info(f"=== Stage 2: probing top {len(to_probe)} candidates ===")
    reports: list[ProbeReport] = []
    for i, c in enumerate(to_probe, 1):
        log.info(f"[probe] {i}/{len(to_probe)}: {c.domain}")
        reports.append(probe(c.domain))

    log.info("=== Stage 3: ranking ===")
    ranked = rank(reports)

    json_path = out_dir / f"candidates_{today}.json"
    md_path = out_dir / f"report_{today}.md"
    json_path.write_text(json.dumps(to_dict_list(ranked), indent=2))
    md_path.write_text(to_issue_markdown(ranked, limit=args.limit))

    print(f"\nTop {args.limit} candidates:\n")
    print(to_issue_markdown(ranked, limit=args.limit))
    print(f"\nArtifacts:\n  {json_path}\n  {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
