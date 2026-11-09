#!/usr/bin/env bash
# Forces a recent-window sync through POST /api/v1/sync (needs a token with the "sync" scope).
# Meant for cron, shortly before a scheduled check-in. Reads TINA_API_TOKEN from ~/tina/.env.local,
# appends one line per run to ~/tina/logs/cron-sync.log:
#   <local timestamp> http=<code> status=<data.status or -> [error=<code>]
# Exits non-zero on any non-2xx answer (and when the token or curl is unavailable).
# The token is never printed or logged: it reaches curl through a config on stdin, not argv.
# A log line is written on every path, including unexpected failures (EXIT trap).
#
# Optional TINA_SYNC_URL overrides the endpoint (https, or http on localhost) for testing.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
LOG_DIR="$ROOT/logs"
LOG="$LOG_DIR/cron-sync.log"
URL="${TINA_SYNC_URL:-https://tina.kindahl.org/api/v1/sync}"

mkdir -p "$LOG_DIR"
logged=0
body_file=""
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*" >> "$LOG"; logged=1; }
# Runs on every exit path: removes the temp file and, if nothing was logged yet
# (unexpected failure), writes a line so a run never leaves no trace.
on_exit() {
  rc=$?
  [ -z "$body_file" ] || rm -f "$body_file"
  [ "$logged" -eq 1 ] || log "http=000 status=- error=script_failure rc=$rc"
}
trap on_exit EXIT

case "$URL" in
  *@*) log "http=000 status=- error=refused_url"; echo "cron-sync: refusing URL with credentials" >&2; exit 1 ;;
  https://*|http://127.0.0.1:[0-9]*/*|http://localhost:[0-9]*/*) ;;
  *) log "http=000 status=- error=refused_url"; echo "cron-sync: refusing non-https URL" >&2; exit 1 ;;
esac

token=""
if [ -r "$ENV_FILE" ]; then
  token="$(grep -m1 -E '^[[:space:]]*(export[[:space:]]+)?TINA_API_TOKEN[[:space:]]*=' "$ENV_FILE" \
    | sed -E 's/^[^=]*=//' | tr -d "\r\"' ")"
fi
if [ -z "$token" ]; then
  log "http=000 status=- error=no_token"
  echo "cron-sync: TINA_API_TOKEN not found in $ENV_FILE" >&2
  exit 1
fi

body_file="$(mktemp)"

# The token goes to curl as a config on stdin (here-string), so it is never in argv.
code="$(curl -sS -K - -X POST -H 'Content-Type: application/json' -d '{"force":true}' \
    --max-time 130 -o "$body_file" -w '%{http_code}' "$URL" 2>/dev/null \
    <<< "header = \"Authorization: Bearer $token\"")"
curl_rc=$?
[ -n "$code" ] || code="000"
unset token

status="$(grep -o '"status":"[a-z_]*"' "$body_file" 2>/dev/null | head -1 | cut -d'"' -f4)"
errcode="$(grep -o '"code":"[a-z_]*"' "$body_file" 2>/dev/null | head -1 | cut -d'"' -f4)"
line="http=$code status=${status:--}"
[ -z "$errcode" ] || line="$line error=$errcode"
[ "$curl_rc" -eq 0 ] || line="$line curl_rc=$curl_rc"
log "$line"

if [ "$curl_rc" -ne 0 ]; then
  echo "cron-sync: curl failed (rc=$curl_rc)" >&2
  exit 1
fi

case "$code" in
  2??) exit 0 ;;
  *) echo "cron-sync: HTTP $code" >&2; exit 1 ;;
esac
