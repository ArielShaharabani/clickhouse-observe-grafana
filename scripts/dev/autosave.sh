#!/usr/bin/env bash
# Autosave worktrees to GitHub every N seconds so another account / session can resume.
# Snapshots the whole working tree (tracked + untracked, respecting .gitignore) through a
# temporary index — the worktree's own index, HEAD and branch are never touched — and
# force-pushes it to origin as `autosave/<branch>` (a commit on top of the branch head).
# Usage: scripts/dev/autosave.sh <interval-seconds> <worktree> [<worktree> ...]
# Resume: git fetch origin && git checkout -b <name> origin/autosave/<branch>
set -u
interval="$1"; shift
while true; do
  for wt in "$@"; do
    [ -d "$wt" ] || continue
    branch=$(git -C "$wt" branch --show-current 2>/dev/null)
    [ -n "$branch" ] || continue
    idx=$(mktemp)
    rm -f "$idx"
    head=$(git -C "$wt" rev-parse HEAD)
    GIT_INDEX_FILE="$idx" git -C "$wt" read-tree "$head"
    GIT_INDEX_FILE="$idx" git -C "$wt" add -A . >/dev/null 2>&1
    tree=$(GIT_INDEX_FILE="$idx" git -C "$wt" write-tree)
    rm -f "$idx"
    if [ "$tree" = "$(git -C "$wt" rev-parse "$head^{tree}")" ]; then
      commit="$head"
    else
      commit=$(git -C "$wt" commit-tree "$tree" -p "$head" -m "autosave: $branch $(date -u +%FT%TZ)")
    fi
    if git -C "$wt" push -q -f origin "$commit:refs/heads/autosave/$branch" 2>/dev/null; then
      echo "$(date +%H:%M:%S) $branch -> autosave/$branch ${commit:0:8}"
    else
      echo "$(date +%H:%M:%S) $branch push failed"
    fi
  done
  sleep "$interval"
done
