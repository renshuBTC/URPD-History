#!/usr/bin/env bash
# Replaces files on a GitHub release without a gap: each new file is uploaded under a temporary name and takes the
# old one's place only once it is complete (a delete and a rename, about a second apart). Until then the old file
# stays downloadable, and a failed upload leaves it as it was. Files are swapped in the order given.
#
#   bash tools/video/replace-asset.sh TAG FILE...     (runs gh; needs GH_TOKEN and GITHUB_REPOSITORY, as in the workflow)
set -euo pipefail
tag=$1; shift
api="repos/${GITHUB_REPOSITORY:?}/releases"
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/replace.XXXXXX"); trap 'rm -rf "$work"' EXIT
retry() { local k; for k in 1 2 3 4 5; do "$@" && return 0; [ "$k" = 5 ] || sleep $((k * 5)); done; return 1; }
for file in "$@"; do
  name=$(basename "$file")
  part="${name%.*}.part.${name##*.}"     # the same extension, so the upload gets the same content type
  ln "$file" "$work/$part" 2>/dev/null || cp "$file" "$work/$part"
  retry gh release upload "$tag" "$work/$part" --clobber
  rm -f "$work/$part"
  assets=$(retry gh api "$api/tags/$tag" --jq '.assets[] | "\(.id) \(.name)"')
  new=$(awk -v n="$part" '$2 == n { print $1 }' <<< "$assets")
  old=$(awk -v n="$name" '$2 == n { print $1 }' <<< "$assets")
  [ -n "$new" ] || { echo "$part is not on the $tag release after its upload" >&2; exit 1; }
  [ -z "$old" ] || retry gh api -X DELETE "$api/assets/$old"
  retry gh api -X PATCH "$api/assets/$new" -f name="$name" --silent
  echo "$tag: $name replaced"
done
