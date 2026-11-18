# Dayrule

**A calm, paper-and-ink task manager with end-to-end encryption.**

Organise work in Inbox, Today, Scheduled, Backlog, Done and Trash — plus
projects, areas, tags, repeats and reminders. Everything meaningful is
encrypted on your device before it syncs. The server only ever stores
ciphertext.

**Use it:** [dayrule.app](https://dayrule.app)

Native companions for iPhone, iPad and Mac live in
[`dayrule-apple`](https://github.com/jonhadfield/dayrule-apple).

---

## Why Dayrule

- **Local-first** — works offline; sync merges in the background
- **End-to-end encrypted** — titles, notes, structure and dates leave the
  device as ciphertext only
- **Paper and ink** — warm, uncluttered UI; Fraunces for headings; no
  trackers or ad SDKs
- **Open signup** — create an account with email verification (no invite)

## Stack

| Layer | Choice |
| --- | --- |
| Web app | React 19, Vite, TypeScript, Tailwind v4 PWA |
| API | Go on Vercel, Postgres (Neon) |
| Crypto | XChaCha20-Poly1305, Argon2id, suite **ALG = 1** |
| Sync | Encrypted records + hybrid logical clocks |

Shared known-answer fixtures for crypto and domain behaviour live in
`docs/shared/` and are mirrored into the native app.

## Develop

```bash
pnpm install
# API (from server/, needs DATABASE_URL for full behaviour)
go run ./cmd/dayruled
# Web (proxies /api → localhost:8080)
pnpm dev
```

Useful checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
and from `server/`: `go test ./...`.

Playwright e2e needs a throwaway Postgres database and Go — see `AGENTS.md`.

## Security (short)

- Encryption happens in the browser (and on device in the native apps)
- 256-bit symmetric keys; no classical-only public-key wrap of user data
- CSP is `'self'` only (plus HIBP range API for breached-password checks)
- Never commit secrets; use `vercel env pull` into gitignored `.env.local`

Full model: [`docs/threat-model.md`](docs/threat-model.md).

## Repository layout

- `web/` — PWA
- `server/` — API, migrations, CLI/MCP
- `tools/things-export/` — optional read-only Mac exporter for Things 3 JSON
- `docs/` — threat model, firewall notes, shared vectors

Agent and contributor conventions: [`AGENTS.md`](AGENTS.md).

## Licence

Source is published for transparency and companion development. Sign up at
[dayrule.app](https://dayrule.app); the privacy notice, terms and ICO fee wait
for a later product launch.
