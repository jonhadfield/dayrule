# Dayrule threat model

Reviewed 2026-11-28 (post-M7 re-review; first full write-up 2026-10-04).
This is the full threat model for the web app and API. Native companions
(`dayrule-apple`) and the local CLI/MCP (`server/cmd/dayrule`) use the same
encrypted sync wire format; this document covers the web delivery path and
shared API. Where a control is enforced in code or CI, the location is given
so it can be checked.

## What we protect

| Asset | Where it lives |
|---|---|
| To-do content: titles, notes, checklists, tags, projects, areas, dates, settings | Encrypted in the browser (XChaCha20-Poly1305 under the account key); IndexedDB and the server hold only ciphertext |
| Account key (AK, 256-bit) | Crypto worker memory while unlocked; otherwise only wrapped: under the password-derived KEK, the recovery key, this device's non-extractable AES-GCM key ("stay unlocked"), or a passkey's PRF output |
| Password and recovery phrase | Never leave the device; the server stores Argon2id(AuthKey) and SHA-256 of a recovery proof |
| Session | `__Host-session` cookie (HttpOnly, Secure, SameSite=Strict); server stores its SHA-256 |
| Email address | Readable on the server (needed for codes and reminder emails) |
| Calendar overlay (optional) | Not vault ciphertext: a local `.ics` stays on device; a fetched https feed is proxied by the API (URL + brief body), then the browser may keep URL + ICS text in `localStorage` for this device only (not synced) |

## Who we defend against

1. **Someone with the database or backups** (Neon breach, leaked backup).
2. **A curious or compelled operator** looking at stored data.
3. **A network attacker**, including one recording traffic to decrypt later with a quantum computer.
4. **Someone with a locked device** (lost or stolen laptop or phone).
5. **Other users** of the service, and **anonymous attackers** on the internet.

Out of scope, by design: an attacker with an *unlocked* device or the OS
account, malicious browser extensions, and a server that serves modified
JavaScript (see "Residual risks").

## Trust boundaries

```
 Browser (trusted when unlocked)          Vercel (untrusted for content)        Neon (untrusted)
 ┌─────────────────────────────┐   TLS    ┌───────────────────────────┐  TLS   ┌──────────────┐
 │ UI ↔ crypto worker (AK)     │ ───────► │ static app (immutable     │ ─────► │ ciphertext,  │
 │ IndexedDB: ciphertext only  │          │ per deployment) + Go API  │        │ account rows │
 │ service worker              │ ◄─────── │ cron: GC, reminders       │        └──────────────┘
 └─────────────────────────────┘          └───────────────────────────┘
         │ HIBP (password check only)              │ Resend, Web Push;
         │ optional calendar host via API          │ optional calendar host (user URL)
 Local CLI/MCP (trusted on that machine): same API, plaintext only in process memory
```

## What the server can see

Account email; ciphertext sizes (padded to buckets); how many records; when
devices sync; IP addresses and device labels for sessions; push endpoints;
and, only if reminders are turned on, when each reminder is due. Record ids
are keyed HMACs, so the server can't tell which records are to-dos, link
them to local ids, or see when they were created. Everything else about the
vault, including record types and timestamps, is inside the ciphertext.

Also (not vault ciphertext, documented in Privacy):

- **Crash reports** (`POST /api/v1/errors`): short message, optional stack,
  build id and user-agent; purged after 30 days. No to-do bodies.
- **Calendar URL fetch** (`POST /api/v1/calendar/ics`): the https feed URL
  and, briefly while proxying, the feed body (event titles and times). The
  API does not store the feed; a local `.ics` file never leaves the device.

## Threats and mitigations

### Confidentiality of content

| Threat | Mitigation | Where |
|---|---|---|
| Database or backup leak | Only ciphertext and wrapped keys are stored; the AK never reaches the server | `web/src/crypto/`, `server/migrations/` |
| Offline guessing of the password from a leak | Argon2id (64 MiB, t=3) client-side; the server stores Argon2id of the derived AuthKey, not anything usable to decrypt | `crypto/primitives.ts`, `server/internal/auth` |
| Server swaps ciphertexts between records or users | AAD binds every record to user id, record id, schema, algorithm and key id; synced records are bound to their server id, which is checked against the HMAC of the decrypted key | `crypto/primitives.ts`, `sync/engine.ts` |
| Server learns structure from ids | Keyed-HMAC sync ids and reminder ids (`dayrule/sync-id/v1`) | `crypto/keyring.ts` (`syncIds`) |
| Size analysis | Padding to buckets (256 B … 4 KiB multiples) | `crypto/primitives.ts` |
| Harvest now, decrypt later | Only symmetric crypto protects content (256-bit keys); TLS negotiates `X25519MLKEM768` on Vercel's edge (checked) | PLAN §10.8 |
| Lost or stolen locked device | IndexedDB holds only ciphertext; the AK is wrapped; auto-lock after 15 minutes unless "stay unlocked" is chosen | `account/Gate.tsx`, `crypto/device-store.ts` |
| Glance at the app switcher / another tab while unlocked | Brand-only privacy cover when the tab is hidden or the page is backgrounded (decision 34); password screens stay opaque | `account/PrivacyCover.tsx` |

### Account and session

| Threat | Mitigation | Where |
|---|---|---|
| Password guessing online | Per-account lockout with backoff; Vercel Firewall rate limits on auth endpoints keyed by IP+JA4 (M7; decision 36) | `httpapi/accounts.go`, `docs/firewall.md` |
| A phished or reused password | Optional second step (decision 30), checked before the server issues a session or the wrapped key: a passkey (the server verifies the WebAuthn assertion; RP ID = the exact host, so a look-alike site can't use it), or a TOTP code (secret sealed under a key from `AUTH_SECRET`, each 30-second step accepted once), or a single-use backup code (keyed HMAC). Adding or removing any of them needs the password and emails a notice, as does using a backup code; the recovery phrase still counts as both factors. TOTP and backup codes can be phished in real time, unlike a passkey, so the UI lists passkeys first | `httpapi/passkeys.go`, `httpapi/twostep.go` |
| Removing the second step with a stolen password and email access | The reset by email waits 7 days, with notices when asked, a day before and when done; signing in with a second step, a new password or Account cancels it. Email access alone still decrypts nothing, and codes are sent only after the password | `httpapi/twostep.go` |
| Guessing a second-step code with a stolen password | 5 codes per sign-in attempt, and a lockout across attempts with back-off that a correct password doesn't reset; about 3 in a million chance per TOTP guess | `httpapi/twostep.go`, `store/twostep.go` |
| Password spraying (one common password across many accounts) | New passwords are refused if they appear in Pwned Passwords; only a 5-character SHA-1 prefix leaves the browser, never through Dayrule's API; fails open | `account/breach.ts` |
| Learning which emails have accounts | Fake salts for unknown emails; identical work and responses; sign-up always returns 202; taken addresses get a decoy code row with the same TTL so verify wrong guesses return `bad_code` like a free address (not `expired_code`); login lockout (`429 locked`) only after a correct AuthKey — wrong keys on a locked account still return `bad_login`; recovery always hashes the proof (dummy compare when the email is unknown) so `bad_recovery` matches for missing and wrong proofs | `httpapi/accounts.go` |
| Session theft by script | HttpOnly cookie; no tokens in JavaScript | `httpapi/accounts.go` |
| Cross-site requests | SameSite=Strict plus a required `X-Dayrule-Client` header on state-changing requests | `httpapi/middleware.go` |
| Email change takeover | Needs the current AuthKey (the password) and a code sent to the new address; the old address is told | `httpapi/accounts.go` |
| Forgotten password | Only the 24-word recovery phrase can unwrap the AK; there is no email reset, by design | PLAN §10.2 |
| Passkey misuse | Device-local: the PRF output unwraps the AK on that device only; the server stores nothing; rp id is the exact host | `account/passkey.ts` |

### The web app itself

| Threat | Mitigation | Where |
|---|---|---|
| Cross-site scripting | React escaping, no `innerHTML`; CSP `script-src 'self' 'wasm-unsafe-eval'`, no inline scripts; Trusted Types with one policy that only accepts our own same-origin worker scripts | `vercel.json`, `web/src/security/headers.test.ts`, `app/trusted.ts` |
| Another site reading memory through side channels (Spectre-style) | Cross-origin isolation: COOP `same-origin`, COEP `require-corp`, CORP `same-origin`, so no other origin's pages or files share the page's process | `vercel.json`, `web/src/security/headers.test.ts` |
| Third-party script compromise | No third-party scripts, fonts, analytics or CDNs; CSP allows only `'self'`, except `connect-src` for the Pwned Passwords data fetch | `vercel.json`, `web/src/security/headers.test.ts` |
| Tampered static files | SRI on every script and stylesheet tag; the crypto worker is fetched with an integrity check before it starts (its hash is in the SRI-checked bundle); immutable Vercel deployments; reproducible builds with a published build hash and `pnpm verify-deploy` | `web/vite.config.ts`, `web/build/`, `.github/workflows/release.yml` |
| Clickjacking | `frame-ancestors 'none'` | `vercel.json` |
| Vulnerable dependencies | Lockfile; `pnpm audit --prod` and `govulncheck` in CI | `.github/workflows/ci.yml` |
| Live WAF drift | Weekly (and on demand) compare of production Firewall rules to `scripts/firewall-desired-state.json` | `.github/workflows/firewall.yml`, `scripts/firewall-check.sh` |
| Live static assets swapped | Daily / after `main` pushes: rebuild the commit `/api/health` reports and byte-compare every file to dayrule.app | `.github/workflows/verify-deploy.yml`, `web/build/verify-deploy.mjs` |

### Availability and abuse

| Threat | Mitigation | Where |
|---|---|---|
| Storage abuse | Quotas: 50 MB, 100,000 records, 64 KB per record | `store/records.go` |
| Sign-up spam | Email verification; Firewall rate limits (IP+JA4); no BotID challenge (decisions 25, 36). Signup is open (`INVITE_ONLY=false`); `INVITE_ONLY` can still require invite codes | `httpapi/accounts.go`, `docs/firewall.md` |
| Calendar URL fetch SSRF | Session-required same-origin proxy; https only; no credentials in URL; DNS must be public-only (redirects re-checked); dial pins those IPs (no second lookup / rebinding); no HTTP proxy; size and time limits; body must look like VCALENDAR | `httpapi/calendar.go`, `safehttp` |
| Crash-report abuse / PII in stacks | Message and stack only (clipped); no request bodies logged; 30-day purge via GC cron; owner list via `cmd/error-reports` | `httpapi/errors.go`, `app/errors.ts`, decision 10 |
| Push subscription SSRF | Subscribe requires https + public host (same rules as calendar); Web Push HTTP client dials only public IPs and ignores proxies | `httpapi/reminders.go`, `push`, `safehttp` |
| CGNAT / shared public IP exhausting auth budgets | Rate-limit keys `ip`+`ja4`, not IP alone; no spoofable `X-Dayrule-Client` exemption | `docs/firewall.md`, PLAN decision 36 |
| Cron endpoints called by others | Bearer `CRON_SECRET`, compared in constant time | `httpapi/sync.go`, `httpapi/reminders.go` |

## Residual risks

- **Malicious JavaScript from the server.** Anyone who can change what
  dayrule.app serves (the Vercel account, the GitHub repo and its CI) could
  ship code that reads data after you unlock. This is the fundamental limit of
  end-to-end encryption delivered over the web. Mitigations: 2FA on Vercel and
  GitHub, protected branches, immutable deployments, SRI, and reproducible
  builds that anyone can check with `pnpm verify-deploy`. The service worker
  only switches to a new version when you choose Reload. SRI can't protect
  `index.html` itself, and the crypto worker's check is a separate fetch from
  the one that starts it, so a server that answers the two differently could
  get past it; it stops a changed file, not a server set on deceiving you.
- **Withholding and rollback.** The server can't read or forge records, but it
  can withhold them or serve an older version of a record. Devices that
  already have newer data keep it (merging uses per-field clocks), but a new
  device could see stale or missing items. There is no signed record-set
  manifest; adding one is possible future work.
- **Metadata** listed above, including reminder times when reminders are on,
  push endpoints, and crash-report stacks.
- **Calendar overlay.** Fetching a feed URL means the API (and the calendar
  host) see the request; Dayrule briefly sees event titles and times in the
  response body. Remembered feeds on this device sit in `localStorage` as
  plaintext ICS, outside the vault encryption and sync model. Prefer a local
  `.ics` file when that matters.
- **Have I Been Pwned.** When choosing a new password, the browser sends a
  5-character SHA-1 prefix to `api.pwnedpasswords.com` (decision 31). That
  party sees the user's IP and the prefix, not the account. The check fails
  open if unreachable.
- **An unlocked device.** Anyone using an unlocked device, or the OS account
  of a device set to stay unlocked, can read everything. Browser extensions
  with page access can too. The privacy cover only hides content from a glance
  at the switcher or another tab; it does not stop an attacker on the same
  unlocked session.
- **Local CLI / MCP.** Credentials (and optional TOTP secret) live in the
  environment or a local creds file; decrypted titles live in that process.
  Anyone who can read that machine's process memory or the creds file can
  read the vault for that account. Prefer a dedicated agent account; see
  `docs/cli-mcp.md`.
- **Recovery is all or nothing.** Losing both the password and the recovery
  phrase loses the data; nobody can recover it.
- **Email provider.** Resend sees the email address, sign-up and change
  codes, and reminder times for email reminders (never content).

## Review

Re-review this document when the crypto, the sync protocol, the hosting, or
anything that adds a new party (a provider, a script, an endpoint) changes.

**2026-11-28:** Confirmed mitigations already in the tables for two-step
sign-in, breached-password check, Firewall IP+JA4, recovery timing oracle,
calendar/push SSRF, WAF desired-state CI and verify-deploy. Added server
visibility for crash reports and calendar URL fetch; privacy cover;
open-signup note; residual risks for calendar overlay, HIBP, and the local
CLI/MCP. No new code gaps found that need a fix in this pass.
