#!/usr/bin/env bash
# post-session.sh — Remind to update rolling context at session end
# This can be triggered manually: bash .claude/hooks/post-session.sh

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CONTEXT_FILE="$REPO_ROOT/context/ROLLING_CONTEXT.md"
LAST_UPDATED=$(grep "Last Updated:" "$CONTEXT_FILE" 2>/dev/null | head -1 | sed 's/.*Last Updated: //')

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          📋  SESSION END — UPDATE ROLLING CONTEXT            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                              ║"
echo "║  Before ending this session, please update:                 ║"
echo "║                                                              ║"
echo "║  1. context/ROLLING_CONTEXT.md                              ║"
echo "║     • What was accomplished this session                    ║"
echo "║     • Decisions made and why                                ║"
echo "║     • Open questions / blockers                             ║"
echo "║     • Update 'Last Updated' date                            ║"
echo "║                                                              ║"
echo "║  2. context/DECISIONS.md (if architecture decisions made)   ║"
echo "║                                                              ║"
echo "║  3. context/BACKLOG.md (if tasks changed)                   ║"
echo "║                                                              ║"
if [ -n "$LAST_UPDATED" ]; then
echo "║  Context last updated: $LAST_UPDATED"
echo "║                                                              ║"
fi
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
