# Dayrule

A calm task manager for desktop and mobile web, with client-side
(end-to-end) encryption and a paper-and-ink identity.

Product and architecture decisions live in a local `PLAN.md` (gitignored,
not published). Read the relevant section before changing behaviour, and
update that local plan when a decision changes. Shared crypto, sync and
wire behaviour must stay compatible with companion clients (including the
native app).

## Layout

- `web/` — React 19 + Vite + TypeScript + Tailwind v4 PWA (pnpm workspace).
- `server/` — Go API (`cmd/dayruled`), migrations (`migrations/`, goose,
  embedded), migration runner (`cmd/migrate`), local CLI/MCP (`cmd/dayrule`;
  see `docs/cli-mcp.md`).
- `tools/things-export/` — read-only Things 3 → JSON exporter (import via
  Account → Your data).
- `vercel.json` — Vercel Services: `web` (static) and `api` (Go Function);
  `/api/*` goes to the API, everything else to the SPA.

## Commands

From the repo root:

- `pnpm install` — install web dependencies.
- `pnpm dev` — Vite dev server; proxies `/api` to `localhost:8080`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`.
- `web/scripts/icons.sh` — re-renders the PWA icons in `web/public/icons/`
  and site favicons (`favicon.ico`, `favicon-32.png`, `favicon.svg`; needs
  `rsvg-convert` and ImageMagick `magick`). Commit the PNGs and ICO.
- `pnpm e2e` — Playwright end-to-end tests against the real API. Needs Go and
  `E2E_DATABASE_URL` pointing at a **throwaway** Postgres database (it is
  migrated and filled with test accounts), e.g. the local test container's
  `postgres://postgres:test@localhost:55432/dayrule_e2e?sslmode=disable`
  after `CREATE DATABASE dayrule_e2e`. Ports 8080 and 5199 must be free.

From `server/`:

- `go run ./cmd/dayruled` — API on `:8080`. Without `DATABASE_URL` it runs with
  no database and `/api/health` reports `"database": "unconfigured"`.
- `go run ./cmd/dayrule …` — local CLI / `mcp` (needs `DAYRULE_EMAIL` and
  `DAYRULE_PASSWORD`; see `docs/cli-mcp.md`).
- `go test ./...`, `go vet ./...`, `golangci-lint run ./...`.
- `go run ./cmd/migrate status|up|down` — needs `DATABASE_URL_UNPOOLED`.
- `go run ./cmd/invite [n]` — prints n single-use invite codes; needs only
  that environment's `DATABASE_URL_UNPOOLED` (invites are stored as SHA-256).
- `go run ./cmd/error-reports [n]` — lists the newest n client crash reports
  (message/stack only; decision 10). Needs `DATABASE_URL_UNPOOLED`.
- `go run ./cmd/dayrule-ops users|stats|delete --email=…` — local operator
  tooling (account list, usage metadata, delete with email confirmation).
  Metadata only; needs `DATABASE_URL_UNPOOLED` for that environment.
- `go run ./cmd/plaintext-check needle…` — lists the `table.column`s where
  any needle appears (also inside base64); used by `web/e2e/no-plaintext.e2e.ts`.
  Needs `DATABASE_URL_UNPOOLED`.
- Integration tests need `TEST_DATABASE_URL`. Locally:
  `docker run --rm -d --name dayrule-test-pg -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=dayrule_test postgres:18`
  then `TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/dayrule_test?sslmode=disable go test ./...`.
  CI runs a Postgres service.

From `tools/things-export/`:

- `go run . -o things.json` — export Things 3 (discovers the Mac DB, or
  pass `-db` to `main.sqlite`). See `tools/things-export/README.md`.
- `go test ./...` — fixture + date packing tests.

CI (`.github/workflows/ci.yml`) runs all of the above checks on every PR.

## Workflow rules

- Never commit to `main` or `preview` directly; both are protected. Work on a
  feature branch → PR into `preview` → check on `preview.dayrule.app` → PR
  `preview` into `main` (merge commit, not squash, so histories stay aligned).
- Migrations must be backwards-compatible (expand → migrate → contract): the
  previous deployment keeps serving during a rollout. They run in the Vercel
  build only for production and the `preview` branch
  (`server/scripts/vercel-build.sh`).

## Identity rules

- Use Dayrule’s own vocabulary in UI and code: Inbox, Today, Scheduled,
  Backlog, Not now, Done, Trash, Add.
- Use the design tokens in `web/src/styles/tokens.css`; don’t hard-code
  colours.

## Databases

- Production → Neon `main`; `preview.dayrule.app` → `preview`; other preview
  deployments and local development (`vercel env pull`) → `dev`.

## Security rules (non-negotiable)

- The server must never see plaintext user content. Encryption happens in the
  browser. Never log request or response bodies.
- 256-bit symmetric keys only; no classical-only public-key crypto protecting
  user data.
- No third-party scripts, analytics or trackers; the CSP in `vercel.json`
  enforces `'self'` only. The one exception is `connect-src
https://api.pwnedpasswords.com` for the breached-password check;
  don’t add others.
- Never test Firewall rate limits from the owner’s connection against
  production: a block applies to that IP for the whole site. Firewall rules
  must not use persistent actions (`actionDuration`).
- Never write secrets into code, docs, commits or PR text. Use env var names
  (`DATABASE_URL`, `RESEND_API_KEY`, …). Get values with `vercel env pull`
  into `.env.local` (gitignored).
