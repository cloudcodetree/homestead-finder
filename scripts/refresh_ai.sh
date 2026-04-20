#!/usr/bin/env bash
# Refresh the AI-enriched listings and Top Picks curation locally.
#
# Runs (in order):
#   1. scraper.enrich  — adds aiTags, homesteadFitScore, redFlags, aiSummary
#                        to any new/changed listings in data/listings.json
#   2. scraper.curate  — generates data/curated.json from the enriched set
#   3. scraper.ai_costs — prints a summary of Claude usage since last refresh
#
# Requires: `claude login` OAuth on the machine (Claude Max subscription).
# See ADR-012 for why these are local-only.
#
# Usage:
#   ./scripts/refresh_ai.sh                # haiku enrich, sonnet curate
#   ./scripts/refresh_ai.sh --force        # re-enrich everything
#   ENRICH_MODEL=sonnet ./scripts/refresh_ai.sh
#   CURATE_COUNT=20 ./scripts/refresh_ai.sh

set -euo pipefail

# Work from repo root regardless of where the script is invoked from
cd "$(dirname "$0")/.."

ENRICH_MODEL="${ENRICH_MODEL:-haiku}"
CURATE_MODEL="${CURATE_MODEL:-sonnet}"
CURATE_COUNT="${CURATE_COUNT:-12}"
CANDIDATES="${CANDIDATES:-50}"
CONCURRENCY="${CONCURRENCY:-4}"
FORCE_FLAG=""

for arg in "$@"; do
  case "$arg" in
    --force) FORCE_FLAG="--force" ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

echo "━━━ 1/3 enriching listings ($ENRICH_MODEL, concurrency=$CONCURRENCY) ━━━"
cd scraper
python3 -m enrich \
  --model "$ENRICH_MODEL" \
  --concurrency "$CONCURRENCY" \
  $FORCE_FLAG

echo
echo "━━━ 2/3 curating Top Picks ($CURATE_MODEL, count=$CURATE_COUNT) ━━━"
python3 -m curate \
  --model "$CURATE_MODEL" \
  --count "$CURATE_COUNT" \
  --candidates "$CANDIDATES"

echo
echo "━━━ 3/3 cost summary ━━━"
python3 -m ai_costs

echo
echo "done. commit data/listings.json and data/curated.json to deploy."
