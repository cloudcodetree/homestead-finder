#!/usr/bin/env bash
# Wire the repo's git hooks into .git/hooks/. Run once per clone:
#
#   ./scripts/install-hooks.sh
#
# Adds:
#   - pre-commit: runs scripts/check-codegen.sh so a commit that
#     forgets to regenerate ai-vocab.generated.ts (or any future
#     generated artifact) fails locally instead of in CI.

set -euo pipefail
cd "$(dirname "$0")/.."

HOOK_PATH=".git/hooks/pre-commit"
cat > "$HOOK_PATH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
./scripts/check-codegen.sh
./scripts/check-secret-exposure.sh
EOF
chmod +x "$HOOK_PATH"
chmod +x scripts/check-codegen.sh
echo "✓ installed pre-commit hook → ${HOOK_PATH}"
