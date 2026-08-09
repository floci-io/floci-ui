#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
BRANCH="${BRANCH:-$(git branch --show-current 2>/dev/null || echo 'unknown')}"
TEAM_DIRECTIVES=""

INIT_OPTIONS="${PROJECT_ROOT}/.specify/init-options.json"
if [[ -f "$INIT_OPTIONS" ]]; then
  TEAM_DIRECTIVES=$(python3 -c "
import json, sys
try:
    with open('$INIT_OPTIONS') as f:
        print(json.load(f).get('team_ai_directives', ''))
except Exception:
    print('')
" 2>/dev/null || true)
fi

if [[ -z "$TEAM_DIRECTIVES" ]]; then
  TEAM_DIRECTIVES="${PROJECT_ROOT}/.specify/team-ai-directives"
fi

if [[ "${1:-}" == "--json" || "${1:-}" == "-Json" ]]; then
  printf '{"REPO_ROOT": "%s", "TEAM_DIRECTIVES": "%s", "BRANCH": "%s"}\n' \
    "$PROJECT_ROOT" "$TEAM_DIRECTIVES" "$BRANCH"
else
  echo "REPO_ROOT=$PROJECT_ROOT"
  echo "TEAM_DIRECTIVES=$TEAM_DIRECTIVES"
  echo "BRANCH=$BRANCH"
fi
