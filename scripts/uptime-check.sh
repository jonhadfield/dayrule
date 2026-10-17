#!/usr/bin/env bash
# Probe Dayrule's public health endpoint from outside the Vercel/Neon network.
# Usage: scripts/uptime-check.sh [origin]
# Exit 0 only when HTTP 200 and JSON status=ok, database=ok.
set -euo pipefail

ORIGIN="${1:-https://dayrule.app}"
URL="${ORIGIN%/}/api/health"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT

code="$(curl -sS -o "$body" -w '%{http_code}' \
  --connect-timeout 10 --max-time 30 \
  -H 'Accept: application/json' \
  -H 'User-Agent: dayrule-uptime-check/1' \
  "$URL")"

echo "GET $URL → HTTP $code"
cat "$body"
echo

if [[ "$code" != "200" ]]; then
  echo "uptime-check: expected HTTP 200, got $code" >&2
  exit 1
fi

python3 - "$body" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
status = data.get("status")
database = data.get("database")
version = data.get("version")
print(f"status={status!r} database={database!r} version={version!r}")
if status != "ok" or database != "ok":
    sys.exit(f"uptime-check: want status=ok database=ok, got status={status!r} database={database!r}")
if not version:
    sys.exit("uptime-check: missing version")
PY
