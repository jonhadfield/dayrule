#!/bin/sh
# Start the API for end-to-end tests: migrate a throwaway database, then
# run the server with email codes logged (no RESEND_API_KEY) to a file the
# tests read. Needs E2E_DATABASE_URL; never point it at a real database.
set -eu
: "${E2E_DATABASE_URL:?set E2E_DATABASE_URL to a throwaway Postgres database}"
out="$(pwd)/e2e/.out"
mkdir -p "$out"
cd ../server
DATABASE_URL_UNPOOLED="$E2E_DATABASE_URL" go run ./cmd/migrate up
go build -o "$out/dayruled" ./cmd/dayruled
go build -o "$out/invite" ./cmd/invite
go build -o "$out/plaintext-check" ./cmd/plaintext-check
AUTH_SECRET="$(openssl rand -hex 32)" INVITE_ONLY=false DATABASE_URL="$E2E_DATABASE_URL" PASSKEY_ORIGINS=http://localhost:5199 PORT=8080 exec "$out/dayruled" > "$out/api.log" 2>&1
