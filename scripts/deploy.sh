#!/usr/bin/env bash
# Deploys the app container on the home server.
#
# Schema changes: run drizzle-kit push BEFORE deploying; the two go together.
# Rollback: git revert, then deploy again.
#
# Never runs drizzle-kit and never touches the db service (--no-deps).
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "deploy: $1" >&2; exit 1; }

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || fail "must be on branch main (on '$branch')"
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean"

docker compose build app
docker compose up -d --no-deps app

url="http://127.0.0.1:3101/"
deadline=$((SECONDS + 90))
while [ "$SECONDS" -lt "$deadline" ]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)"
  # Any answer below 500 means the server is up (the root redirects to sign-in).
  if [ -n "$code" ] && [ "$code" != "000" ] && [ "$code" -lt 500 ]; then
    echo "deploy: app answered HTTP $code on $url"
    exit 0
  fi
  sleep 2
done
fail "app did not answer on $url within 90s (try: docker compose logs app)"
