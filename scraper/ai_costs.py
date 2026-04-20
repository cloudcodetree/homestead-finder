"""Append-only log of local Claude usage.

Records what `llm.call()` would have cost at API rates (from the CLI's
`total_cost_usd` envelope field). On a Max subscription those numbers are
informational — the user didn't actually pay them per-call — but they're
useful to (a) see what fraction of Max quota this project is burning and
(b) estimate what migrating to API would cost.

File format: JSONL at `data/ai_costs.jsonl` — one record per call. Each
record has:

    {
      "ts": "2026-04-20T22:00:00+00:00",
      "model": "haiku",
      "input_tokens": 100,
      "output_tokens": 50,
      "cost_usd": 0.001,
      "cached": false,
      "tag": "enrich" | "curate" | "query" | null
    }

Cached hits have cost 0 and `"cached": true`. Callers can also pass a tag
to group records by pipeline phase.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from config import DATA_DIR

COST_LOG = DATA_DIR / "ai_costs.jsonl"


def record(
    *,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    cached: bool = False,
    tag: str | None = None,
) -> None:
    """Append one call's cost record. Swallows OSError — tracking must never
    break the caller."""
    entry: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "model": model,
        "input_tokens": int(input_tokens),
        "output_tokens": int(output_tokens),
        "cost_usd": round(float(cost_usd), 6),
        "cached": bool(cached),
    }
    if tag:
        entry["tag"] = tag
    try:
        COST_LOG.parent.mkdir(parents=True, exist_ok=True)
        with COST_LOG.open("a") as fh:
            fh.write(json.dumps(entry) + "\n")
    except OSError:
        # Failure here should never break the caller — the whole point is
        # this is observational.
        pass


def summarize(
    *,
    since: datetime | None = None,
    tag: str | None = None,
) -> dict[str, Any]:
    """Aggregate cost records. Useful from CLI or tests.

    Returns { calls, cached_calls, input_tokens, output_tokens, cost_usd }.
    """
    totals = {
        "calls": 0,
        "cached_calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cost_usd": 0.0,
        "by_model": {},
        "by_tag": {},
    }
    if not COST_LOG.exists():
        return totals

    with COST_LOG.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            if since is not None:
                try:
                    ts = datetime.fromisoformat(entry["ts"])
                except (KeyError, ValueError):
                    continue
                if ts < since:
                    continue

            entry_tag = entry.get("tag")
            if tag is not None and entry_tag != tag:
                continue

            totals["calls"] += 1
            if entry.get("cached"):
                totals["cached_calls"] += 1
            totals["input_tokens"] += int(entry.get("input_tokens", 0) or 0)
            totals["output_tokens"] += int(entry.get("output_tokens", 0) or 0)
            totals["cost_usd"] += float(entry.get("cost_usd", 0) or 0)

            model = entry.get("model", "unknown")
            totals["by_model"][model] = totals["by_model"].get(model, 0) + 1
            if entry_tag:
                totals["by_tag"][entry_tag] = totals["by_tag"].get(entry_tag, 0) + 1

    totals["cost_usd"] = round(totals["cost_usd"], 6)
    return totals


def main() -> None:
    """Quick CLI: `python -m scraper.ai_costs` prints a summary."""
    totals = summarize()
    print(f"AI call summary ({COST_LOG}):")
    print(f"  total calls:   {totals['calls']}")
    print(f"  cached hits:   {totals['cached_calls']}")
    print(f"  input tokens:  {totals['input_tokens']:,}")
    print(f"  output tokens: {totals['output_tokens']:,}")
    print(f"  est cost (API rates): ${totals['cost_usd']:.4f}")
    if totals["by_model"]:
        print("  by model:")
        for m, n in sorted(totals["by_model"].items()):
            print(f"    {m}: {n}")
    if totals["by_tag"]:
        print("  by tag:")
        for t, n in sorted(totals["by_tag"].items()):
            print(f"    {t}: {n}")


if __name__ == "__main__":
    main()
