#!/usr/bin/env bash
# Post-commit hook: run relevant tests
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
LAST_COMMIT_FILES="$(git diff-tree --no-commit-id -r --name-only HEAD)"

echo "🧪 Running post-commit tests..."

# ── Python tests ─────────────────────────────────────────────────────────────
if echo "$LAST_COMMIT_FILES" | grep -q '^scraper/'; then
  echo ""
  echo "🐍 Running Python tests..."
  cd "$REPO_ROOT/scraper"
  if python -m pytest tests/ -v --tb=short; then
    echo "✅ Python tests passed."
  else
    echo "⚠️  Python tests failed. Check above for details."
  fi
  cd "$REPO_ROOT"
fi

# ── Frontend build check ──────────────────────────────────────────────────────
if echo "$LAST_COMMIT_FILES" | grep -q '^frontend/'; then
  echo ""
  echo "📦 Checking frontend builds cleanly..."
  cd "$REPO_ROOT/frontend"
  if npm run build --silent; then
    echo "✅ Frontend build passed."
  else
    echo "⚠️  Frontend build failed. Check above for details."
  fi
  cd "$REPO_ROOT"
fi

echo ""
echo "✅ Post-commit checks complete."
