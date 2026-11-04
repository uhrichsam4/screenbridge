#!/usr/bin/env bash
# Copies a built macOS voxl binary and the Homebrew dylibs it links (x264, opus) into
# resources/bin/, points them at each other with @loader_path and ad-hoc signs them,
# so the app runs on a Mac without Homebrew.
#
# Usage: scripts/prepare-voxl-mac.sh path/to/voxl
set -euo pipefail

src="${1:?usage: $0 path/to/voxl}"
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/resources/bin"

rm -rf "$out"
mkdir -p "$out"
cp "$src" "$out/voxl"
chmod 755 "$out/voxl"

# Non-system libraries the binary links (anything outside /usr/lib and /System).
deps() {
  otool -L "$1" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/|@)' || true
}

# Copy every non-system dylib (and the ones those link), breadth first.
queue=("$out/voxl")
while [ ${#queue[@]} -gt 0 ]; do
  file="${queue[0]}"
  queue=("${queue[@]:1}")
  for dep in $(deps "$file"); do
    name="$(basename "$dep")"
    if [ ! -f "$out/$name" ]; then
      real="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$dep")"
      cp "$real" "$out/$name"
      chmod 644 "$out/$name"
      install_name_tool -id "@loader_path/$name" "$out/$name"
      queue+=("$out/$name")
    fi
    install_name_tool -change "$dep" "@loader_path/$name" "$file"
  done
done

# Drop rpaths that point into Homebrew (the linker adds them; nothing needs them now).
for f in "$out"/*; do
  otool -l "$f" | awk '/cmd LC_RPATH/{r=1} r && $1=="path"{print $2; r=0}' | while read -r rp; do
    case "$rp" in
      /opt/homebrew/* | /usr/local/*) install_name_tool -delete_rpath "$rp" "$f" ;;
    esac
  done
done

# install_name_tool invalidates signatures; arm64 needs at least an ad-hoc one.
for f in "$out"/*.dylib "$out/voxl"; do
  [ -f "$f" ] && codesign --force -s - "$f"
done

echo "Bundled into $out:"
ls -l "$out"
for f in "$out"/*; do otool -L "$f"; done
if otool -l "$out"/* | grep -q /opt/homebrew; then
  echo "error: /opt/homebrew paths remain:" >&2
  otool -l "$out"/* | grep -B3 /opt/homebrew >&2
  exit 1
fi
"$out/voxl" --help >/dev/null
echo "ok: $out/voxl runs"
