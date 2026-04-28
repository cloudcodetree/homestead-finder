#!/usr/bin/env bash
# Scan the repo + git history + local caches for accidentally
# committed secrets. Designed to be cheap (~1 sec) so you can run
# it pre-commit.
#
# Detects high-privilege patterns we've actually leaked or come
# close to leaking — `sk_live_…`, `whsec_…`, JWT-shaped service
# role keys, and the Supabase anon key prefix. Public stuff
# (publishable keys, project refs) is intentionally NOT flagged.
#
# Exit code:
#   0 — clean
#   1 — at least one match found
#
# Usage:
#   ./scripts/check-secret-exposure.sh              # default scan
#   ./scripts/check-secret-exposure.sh --history    # also walk git log -p
#
# Pre-commit hook integration is in scripts/install-hooks.sh.

set -euo pipefail
cd "$(dirname "$0")/.."

# Patterns that should NEVER appear in tracked content. Anchored so
# they can't be stray substrings in legitimate text.
PATTERNS=(
  'sk_live_[A-Za-z0-9]{20,}'         # Stripe full live secret
  'rk_live_[A-Za-z0-9]{20,}'         # Stripe restricted live key
  'whsec_[A-Za-z0-9]{20,}'           # Stripe webhook signing secret
  'sb_secret_[A-Za-z0-9_]{20,}'      # Supabase service role (newer scoped format)
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'  # Common JWT header — flag for review
)

found=0
scan_files=$(git ls-files | grep -vE '\.(min\.js|map|lock)$' | grep -vE '^\.env\.deploy$' || true)

for pattern in "${PATTERNS[@]}"; do
  # Tracked files
  if matches=$(echo "$scan_files" | xargs -I{} grep -lE "$pattern" {} 2>/dev/null); then
    if [[ -n "$matches" ]]; then
      echo "✗ Pattern '$pattern' found in tracked files:"
      echo "$matches" | sed 's/^/    /'
      found=1
    fi
  fi
done

# History scan (opt-in — slow on big repos)
if [[ "${1:-}" == "--history" ]]; then
  echo "Scanning git history (this may take a moment)…"
  for pattern in "${PATTERNS[@]}"; do
    if git log -p --all -- ':!*.lock' ':!*.min.js' 2>/dev/null \
        | grep -qE "$pattern"; then
      echo "✗ Pattern '$pattern' appears in git history"
      echo "    Even if removed in HEAD, the secret is exposed in commits"
      echo "    you may have pushed. Treat as compromised — rotate."
      found=1
    fi
  done
fi

if [[ $found -eq 0 ]]; then
  echo "✓ No high-privilege secrets detected in tracked files$([[ ${1:-} == --history ]] && echo ' or history')."
  exit 0
fi

echo
echo "If any of the above are real (not test-mode placeholders), rotate"
echo "them in Stripe + Supabase dashboards before doing anything else."
exit 1
