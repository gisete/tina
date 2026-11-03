#!/usr/bin/env bash
# Runs every src/**/*.fixture.ts via tsx; fails fast on the first non-zero exit.
set -euo pipefail
cd "$(dirname "$0")/.."
count=0
while IFS= read -r f; do
  echo "→ $f"
  npx tsx "$f" > /dev/null
  count=$((count + 1))
done < <(find src -name '*.fixture.ts' | sort)
echo "fixtures: $count passed"
