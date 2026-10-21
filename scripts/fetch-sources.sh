#!/bin/sh
# Fetch the exact Convex commits the code excerpts are pinned to (see src/code/types.ts).
set -e
DEST="${SRC_REF:-../src-ref}"
fetch() {
  repo="$1"; sha="$2"
  mkdir -p "$DEST/$repo"
  cd "$DEST/$repo"
  [ -d .git ] || git init -q
  git fetch -q --depth 1 "https://github.com/get-convex/$repo.git" "$sha"
  git checkout -q FETCH_HEAD
  cd - >/dev/null
}
fetch convex-backend "$(sed -n "s/.*'convex-backend': '\([0-9a-f]*\)'.*/\1/p" src/code/types.ts)"
fetch convex-js "$(sed -n "s/.*'convex-js': '\([0-9a-f]*\)'.*/\1/p" src/code/types.ts)"
echo "Sources ready in $DEST"
