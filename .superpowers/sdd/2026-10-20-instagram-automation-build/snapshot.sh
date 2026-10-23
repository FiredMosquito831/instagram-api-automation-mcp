#!/usr/bin/env bash
# Freeze the project's buildable tree as snap/NAME (no git in this project).
set -euo pipefail
PROJECT="/d/Projects2/InstagramApi"
WS="$PROJECT/.superpowers/sdd/2026-10-20-instagram-automation-build"
dest="$WS/snap/$1"
rm -rf "$dest"; mkdir -p "$dest"
(cd "$PROJECT" && tar --exclude=./node_modules --exclude=./data --exclude=./docs --exclude=./reports \
  --exclude=./research_notes --exclude=./.superpowers --exclude=./.remember --exclude=./coverage --exclude=./bash.exe.stackdump -cf - .) \
  | (cd "$dest" && tar -xf -)
echo "$dest"
