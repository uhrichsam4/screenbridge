#!/usr/bin/env bash
# Applies every patches/*.patch to the voxl submodule. Safe to run again: a patch that
# is already applied is skipped. Does nothing if there are no patches.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
voxl="$root/voxl"
shopt -s nullglob
patches=("$root"/patches/*.patch)

if [ ${#patches[@]} -eq 0 ]; then
  echo "no voxl patches to apply"
  exit 0
fi

for p in "${patches[@]}"; do
  name="$(basename "$p")"
  if git -C "$voxl" apply --check "$p" 2>/dev/null; then
    git -C "$voxl" apply "$p"
    echo "applied $name"
  elif git -C "$voxl" apply --reverse --check "$p" 2>/dev/null; then
    echo "already applied: $name"
  else
    echo "error: $name neither applies nor is already applied to voxl" >&2
    git -C "$voxl" apply --check "$p" || true
    exit 1
  fi
done
