#!/usr/bin/env bash
# Validates that all auto-generated artifacts are in sync with their
# inputs. Fails fast if anything has drifted.
#
# Run by:
#   - .github/workflows/test.yml      (CI gate, blocks merge)
#   - .git/hooks/pre-commit (optional, see scripts/install-hooks.sh)
#
# Today this just checks the AI vocab. Add more `--check`-style
# generators here as the codebase acquires them.

set -euo pipefail

cd "$(dirname "$0")/.."

# AI vocab — single source of truth in scraper/ai_vocab.json,
# emitted to frontend/src/types/ai-vocab.generated.ts.
PY="${PYTHON:-python3}"
( cd scraper && "$PY" -m emit_ts_vocab --check )

echo "✓ all generated artifacts in sync"
