"""Source-discovery pipeline.

Periodically scans the web for new land-listing sources we haven't
yet wired up. Three stages:

    seeds.yml (queries) → discover.py (search) → probe.py (inspect)
                                                    ↓
                                              rank.py (score)
                                                    ↓
                                           scaffold.py (stub)

Run end-to-end via:
    python -m discovery.run

The output is a ranked candidate list written to
`data/discovery/candidates_{date}.json` plus a human-readable summary
on stdout. A weekly GitHub Actions job wraps this and opens an issue
with the top candidates for hand-review.
"""

from __future__ import annotations

__all__: list[str] = []
