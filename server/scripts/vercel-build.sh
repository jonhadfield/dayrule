#!/bin/sh
# Vercel build for the Go API service (see vercel.json).
#
# Migrations run only for production and the long-lived `preview` branch,
# which have their own Neon branches. Other preview deployments skip them so
# a feature branch can never change a shared database's schema.
set -eu

if [ "${VERCEL_ENV:-}" = "production" ] || [ "${VERCEL_GIT_COMMIT_REF:-}" = "preview" ]; then
  echo "Running migrations (env=${VERCEL_ENV:-unknown}, ref=${VERCEL_GIT_COMMIT_REF:-unknown})"
  go run ./cmd/migrate up
else
  echo "Skipping migrations (env=${VERCEL_ENV:-unknown}, ref=${VERCEL_GIT_COMMIT_REF:-unknown})"
fi

go build -trimpath -ldflags '-s -w' -o "${VERCEL_OUTPUT_FILE}" ./cmd/dayruled
