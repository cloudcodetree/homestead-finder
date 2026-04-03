#!/usr/bin/env bash
# Pre-commit hook: lint + type check
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
ERRORS=0

echo "🔍 Running pre-commit checks..."

# ── Frontend checks ──────────────────────────────────────────────────────────
if git diff --cached --name-only | grep -q '^frontend/'; then
  echo ""
  echo "📦 Frontend: ESLint + Prettier + TypeScript..."
  cd "$REPO_ROOT/frontend"

  if ! npm run lint --silent; then
    echo "❌ ESLint failed. Run: cd frontend && npm run lint"
    ERRORS=$((ERRORS + 1))
  fi

  if ! npm run format:check --silent; then
    echo "❌ Prettier check failed. Run: cd frontend && npm run format"
    ERRORS=$((ERRORS + 1))
  fi

  if ! npm run type-check --silent; then
    echo "❌ TypeScript type check failed."
    ERRORS=$((ERRORS + 1))
  fi

  cd "$REPO_ROOT"
fi

# ── Python checks ────────────────────────────────────────────────────────────
if git diff --cached --name-only | grep -q '^scraper/'; then
  echo ""
  echo "🐍 Python: ruff lint + format check..."
  cd "$REPO_ROOT/scraper"

  if ! python -m ruff check .; then
    echo "❌ Ruff lint failed. Run: cd scraper && ruff check --fix ."
    ERRORS=$((ERRORS + 1))
  fi

  if ! python -m ruff format --check .; then
    echo "❌ Ruff format failed. Run: cd scraper && ruff format ."
    ERRORS=$((ERRORS + 1))
  fi

  cd "$REPO_ROOT"
fi

# ── Result ───────────────────────────────────────────────────────────────────
echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ Pre-commit failed with $ERRORS error(s). Fix issues above before committing."
  exit 1
else
  echo "✅ All pre-commit checks passed."
fi
