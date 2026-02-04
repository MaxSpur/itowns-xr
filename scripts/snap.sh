#!/usr/bin/env sh
set -eu

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git repository." >&2
  exit 1
fi

if [ -z "$(git status --porcelain)" ]; then
  echo "No changes to commit."
  exit 0
fi

msg="${1-}"
if [ -z "$msg" ]; then
  printf "Commit message: "
  IFS= read -r msg
fi

if [ -z "$msg" ]; then
  echo "Aborted: empty commit message." >&2
  exit 1
fi

git add -A
git commit -m "$msg"
