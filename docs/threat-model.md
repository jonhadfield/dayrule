# Dayrule threat model

Reviewed 2026-10-04 (M7). Summary in PLAN.md §10.1; this is the full version.
It describes what Dayrule protects, from whom, how, and what it does not
protect against. Where a control is enforced in code or CI, the location is
given so it can be checked.

## What we protect

| Asset | Where it lives |
|---|---|
| To-do content: titles, notes, checklists, tags, projects, areas, dates, settings | Encrypted in the browser (XChaCha20-Poly1305 under the account key); IndexedDB and the server hold only ciphertext |
| Account key (AK, 256-bit) | Crypto worker memory while unlocked; otherwise only wrapped: under the password-derived KEK, the recovery key, this device's non-extractable AES-GCM key ("stay unlocked"), or a passkey's PRF output |
| Password and recovery phrase | Never leave the device; the server stores Argon2id(AuthKey) and SHA-256 of a recovery proof |
| Session | `__Host-session` cookie (HttpOnly, Secure, SameSite=Strict); server stores its SHA-256 |
| Email address | Readable on the server (needed for codes and reminder emails) |

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
                                                   │ Resend (email), Web Push services
```

## What the server can see

Account email; ciphertext sizes (padded to buckets); how many records; when
devices sync; IP addresses and device labels for sessions; push endpoints;
and, only if reminders are turned on, when each reminder is due. Record ids
are keyed HMACs, so the server can't tell which records are to-dos, link
them to local ids, or see when they were created. Everything else, including
record types and timestamps, is inside the ciphertext.

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

### Account and session

| Threat | Mitigation | Where |
|---|---|---|
| Password guessing online | Per-account lockout with backoff; Vercel Firewall rate limits on auth endpoints (M7) | `httpapi/accounts.go` |
| Learning which emails have accounts | Fake salts for unknown emails; identical work and responses; sign-up always returns 202 | `httpapi/accounts.go` |
| Session theft by script | HttpOnly cookie; no tokens in JavaScript | `httpapi/accounts.go` |
| Cross-site requests | SameSite=Strict plus a required `X-Dayrule-Client` header on state-changing requests | `httpapi/middleware.go` |
| Email change takeover | Needs the current AuthKey (the password) and a code sent to the new address; the old address is told | `httpapi/accounts.go` |
| Forgotten password | Only the 24-word recovery phrase can unwrap the AK; there is no email reset, by design | PLAN §10.2 |
| Passkey misuse | Device-local: the PRF output unwraps the AK on that device only; the server stores nothing; rp id is the exact host | `account/passkey.ts` |

### The web app itself

| Threat | Mitigation | Where |
|---|---|---|
| Cross-site scripting | React escaping, no `innerHTML`; CSP `script-src 'self' 'wasm-unsafe-eval'`, no inline scripts; Trusted Types with one policy that only accepts our own same-origin worker scripts | `vercel.json`, `web/src/security/headers.test.ts`, `app/trusted.ts` |
| Third-party script compromise | No third-party scripts, fonts, analytics or CDNs; CSP allows only `'self'` | `vercel.json` |
| Tampered static files | SRI on every script and stylesheet tag; the crypto worker is fetched with an integrity check before it starts (its hash is in the SRI-checked bundle); immutable Vercel deployments; reproducible builds with a published build hash and `pnpm verify-deploy` | `web/vite.config.ts`, `web/build/`, `.github/workflows/release.yml` |
| Clickjacking | `frame-ancestors 'none'` | `vercel.json` |
| Vulnerable dependencies | Lockfile; `pnpm audit --prod` and `govulncheck` in CI | `.github/workflows/ci.yml` |

### Availability and abuse

| Threat | Mitigation | Where |
|---|---|---|
| Storage abuse | Quotas: 50 MB, 100,000 records, 64 KB per record | `store/records.go` |
| Sign-up spam | Invite-only until launch; email verification; rate limits | `httpapi/accounts.go` |
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
  and push endpoints.
- **An unlocked device.** Anyone using an unlocked device, or the OS account
  of a device set to stay unlocked, can read everything. Browser extensions
  with page access can too.
- **Recovery is all or nothing.** Losing both the password and the recovery
  phrase loses the data; nobody can recover it.
- **Email provider.** Resend sees the email address, sign-up and change
  codes, and reminder times for email reminders (never content).

## Review

Re-review this document when the crypto, the sync protocol, the hosting, or
anything that adds a new party (a provider, a script, an endpoint) changes.
