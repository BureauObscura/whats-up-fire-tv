#!/bin/sh
# ./run.sh SEED  (PORT: a dev server for the build under test; OUT: results folder)
s=$1; d=${OUT:-$(dirname "$0")/out}; mkdir -p "$d"
PORT=${PORT:-8775} perl -e 'alarm 600; exec @ARGV' node "$(dirname "$0")/monkey-fix.mjs" "$s" 300 2>/dev/null | tail -1 > "$d/$s.tmp"
if python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "$d/$s.tmp" 2>/dev/null; then mv "$d/$s.tmp" "$d/$s.json"; else mv "$d/$s.tmp" "$d/$s.bad"; fi
