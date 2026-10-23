#!/usr/bin/env bash
# Usage: review.sh BASE_NAME HEAD_NAME OUTFILE — net diff between two snapshots (replaces git diff).
set -uo pipefail
WS="/d/Projects2/InstagramApi/.superpowers/sdd/2026-10-20-instagram-automation-build"
base="$WS/snap/$1"; head="$WS/snap/$2"; out="$3"
lock_state() {
  local b="$base/package-lock.json" h="$head/package-lock.json"
  if [ ! -e "$b" ] && [ ! -e "$h" ]; then echo "no"
  elif [ -e "$b" ] && [ -e "$h" ] && cmp -s "$b" "$h"; then echo "no"
  else echo "yes (excluded from the diff below; read it with cat)"; fi
}
{
  echo "# Review package: $1 -> $2 (snapshot diff; the project is not a git repository)"
  echo
  echo "## Files changed"
  diff -rq --exclude=package-lock.json "$base" "$head" | sed "s#$WS/snap/##g" || true
  echo
  echo "## Lockfile changed"
  lock_state
  echo
  echo "## Diff"
  diff -ruN -U10 --exclude=package-lock.json --exclude=node_modules "$base" "$head" || true
} > "$out"
echo "wrote $out: $(wc -c < "$out") bytes"
