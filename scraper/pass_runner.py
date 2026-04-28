"""DAG runner for post-scrape passes — load corpus once, apply
passes in dependency order, write once.

Today's pipeline runs many passes in sequence (`image_refresh`,
`image_validation`, `enrich_geo`, `enrich`, `curate`, `deals`,
`health_check`). Each pass historically read `data/listings.json`,
mutated it, and wrote it back. That repeated I/O is wasteful as
the corpus grows and creates ordering bugs (a partially-written
file mid-run can corrupt downstream passes).

This module gives passes a tiny shared interface:

    @dataclass
    class Pass:
        name: str
        depends_on: tuple[str, ...] = ()
        skip_env: str | None = None  # SKIP_<X>=1 → bypass
        run: Callable[[Ctx], None]   # mutates ctx in place

A `Ctx` carries the corpus list (mutated in place) and a writable
side-channel for things like notification counts. Passes call
`ctx.listings`, `ctx.note(...)`, etc., never touch disk directly.

The runner:
  1. Loads `data/listings.json` (or whatever path the operator passes)
     into memory once.
  2. Topologically sorts the passes by their declared dependencies.
  3. Runs each non-skipped pass against the live in-memory corpus,
     timing each + recording any per-pass exception (passes don't
     abort the pipeline by default — a single broken pass shouldn't
     block image_refresh from running).
  4. Writes the corpus once at the end.

Idempotency: every pass should already self-gate (most use
`needs_pass` / `_needs_refresh` heuristics). The runner doesn't
add idempotency on top — it just removes the JSON tax.

Adoption is opt-in via `MAIN_USE_PASS_RUNNER=1`. Until the existing
passes are refactored to expose a `run(ctx)` entry point, the
legacy chain in `main.py` continues to work.
"""

from __future__ import annotations

import json
import time
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

from logger import get_logger

log = get_logger("pass_runner")


@dataclass
class Ctx:
    """In-memory corpus + side-channel for a single pipeline run."""

    listings: list[dict[str, Any]]
    notes: dict[str, Any] = field(default_factory=dict)

    def note(self, key: str, value: Any) -> None:
        """Record an arbitrary metric / log line for the run report."""
        self.notes[key] = value


@dataclass
class Pass:
    """One pass in the pipeline DAG."""

    name: str
    run: Callable[[Ctx], None]
    depends_on: tuple[str, ...] = ()
    # Env var that, when truthy, skips this pass. None means
    # "always run". Keeps the existing SKIP_LW_IMAGES /
    # SKIP_IMAGE_REFRESH / HEALTH_CHECK_SKIP escape hatches intact.
    skip_env: str | None = None


def _topo_sort(passes: list[Pass]) -> list[Pass]:
    """Kahn's algorithm. Raises if there's a cycle or a missing
    dependency — those are programmer errors, not data errors,
    so failing fast is correct."""
    name_to = {p.name: p for p in passes}
    indeg = {p.name: 0 for p in passes}
    for p in passes:
        for dep in p.depends_on:
            if dep not in name_to:
                raise ValueError(f"Pass '{p.name}' depends on unknown pass '{dep}'")
            indeg[p.name] += 1
    queue = [name for name, d in indeg.items() if d == 0]
    out: list[Pass] = []
    while queue:
        # Stable order: alphabetic among ready passes so test runs
        # are deterministic.
        queue.sort()
        name = queue.pop(0)
        out.append(name_to[name])
        for p in passes:
            if name in p.depends_on:
                indeg[p.name] -= 1
                if indeg[p.name] == 0:
                    queue.append(p.name)
    if len(out) != len(passes):
        remaining = [p.name for p in passes if p not in out]
        raise ValueError(f"Cyclic dependency among passes: {remaining}")
    return out


def _is_truthy_env(name: str | None) -> bool:
    if not name:
        return False
    val = os.environ.get(name, "").strip().lower()
    return val not in ("", "0", "false", "no", "off")


def run_pipeline(
    listings_path: Path,
    passes: Iterable[Pass],
    *,
    write_back: bool = True,
) -> dict[str, Any]:
    """Load → run → write. Returns a report with per-pass timing
    and any per-pass exception (caller decides what to do with
    failures — most are non-fatal regressions, not show-stoppers)."""
    if not listings_path.exists():
        log.info(f"[pass_runner] no listings file at {listings_path}; nothing to do")
        return {"loaded": 0, "passes": []}

    raw = listings_path.read_text()
    listings = json.loads(raw)
    if not isinstance(listings, list):
        raise ValueError(f"{listings_path} is not a JSON list")
    log.info(f"[pass_runner] loaded {len(listings)} listings from {listings_path}")

    ctx = Ctx(listings=listings)
    ordered = _topo_sort(list(passes))

    report: list[dict[str, Any]] = []
    for p in ordered:
        if _is_truthy_env(p.skip_env):
            log.info(f"[pass_runner] skip {p.name} (env={p.skip_env})")
            report.append({"name": p.name, "status": "skipped"})
            continue
        t0 = time.monotonic()
        try:
            p.run(ctx)
            elapsed = time.monotonic() - t0
            log.info(f"[pass_runner] {p.name} ok in {elapsed:.1f}s")
            report.append({"name": p.name, "status": "ok", "elapsed_s": elapsed})
        except Exception as e:
            elapsed = time.monotonic() - t0
            log.info(
                f"[pass_runner] {p.name} FAILED after {elapsed:.1f}s: "
                f"{type(e).__name__}: {e}"
            )
            report.append(
                {
                    "name": p.name,
                    "status": "error",
                    "elapsed_s": elapsed,
                    "error": f"{type(e).__name__}: {e}",
                }
            )

    if write_back:
        listings_path.write_text(json.dumps(ctx.listings, indent=2))
        log.info(f"[pass_runner] wrote {len(ctx.listings)} listings → {listings_path}")

    return {"loaded": len(listings), "passes": report, "notes": ctx.notes}
