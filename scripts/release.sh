#!/bin/sh
# Release build from a neutral folder, then the package guard.
#   sh scripts/release.sh            -> build/armv7-release/whatsup_armv7.vpkg (checked)
# Why a copy: Hermes records the bundle's input path and native builds embed source
# paths, and the developer's home folder carries their macOS user name. Building from
# /tmp keeps every path in the package neutral. Dependencies are linked, not copied.
set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)
DEPS=${WHATSUP_DEPS:-$SRC}          # a checkout whose node_modules are installed
OUT=/tmp/spacely-build/app
export KEPLER_SDK_PATH=${KEPLER_SDK_PATH:-$HOME/vega/sdk/vega-sdk/main/0.24.12112}
export PATH="$KEPLER_SDK_PATH/bin:$PATH"

rm -rf /tmp/spacely-build && mkdir -p "$OUT"
rsync -a --exclude .git --exclude node_modules --exclude build --exclude assets \
  --exclude 'native/keep-awake/build' --exclude 'native/keep-awake/dist' "$SRC/" "$OUT/"

# Dependencies: the installed checkout's node_modules (Metro needs one real tree). The
# app's native module resolves through it to that checkout's native/keep-awake, so the
# module is built here (neutral paths, prefix maps) and its build output copied there.
ln -s "$(readlink -f "$DEPS/node_modules")" "$OUT/node_modules"
ln -s "$(readlink -f "$DEPS/native/keep-awake/node_modules")" "$OUT/native/keep-awake/node_modules"
mkdir -p "$OUT/vendor" && ln -sfn "$(readlink -f "$DEPS/vendor/node_modules")" "$OUT/vendor/node_modules"

(cd "$OUT/native/keep-awake" && npm run build >/tmp/spacely-build/native.log 2>&1) || { tail -20 /tmp/spacely-build/native.log; exit 1; }
NATIVE=$(readlink -f "$DEPS/node_modules/@whatsup/keep-awake")
rm -rf "$NATIVE/build" "$NATIVE/dist" && cp -R "$OUT/native/keep-awake/build" "$OUT/native/keep-awake/dist" "$NATIVE/"

(cd "$OUT" && npm run build:release >/tmp/spacely-build/app.log 2>&1) || { tail -20 /tmp/spacely-build/app.log; exit 1; }

mkdir -p "$SRC/build/armv7-release"
cp "$OUT/build/armv7-release/whatsup_armv7.vpkg" "$SRC/build/armv7-release/"
node "$SRC/scripts/check-package.mjs" "$SRC/build/armv7-release/whatsup_armv7.vpkg"
