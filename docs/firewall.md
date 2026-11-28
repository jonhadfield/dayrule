# Vercel Firewall (dayrule.app)

Custom WAF rate limits and managed bot settings for the production project.
Desired state lives in `scripts/firewall-desired-state.json`. Check with:

```bash
./scripts/firewall-check.sh
```

Requires the Vercel CLI. Locally: logged in to the `dayrule` project. In CI:
repository secret `VERCEL_TOKEN` and variables `VERCEL_ORG_ID` /
`VERCEL_PROJECT_ID` (see `.github/workflows/firewall.yml`). The check is
**read-only** — it does not publish or probe auth endpoints.

GitHub Actions runs the same script weekly (Monday 05:30 UTC), on demand, and
on PRs that touch the Firewall desired-state files.

## Policy (PLAN decisions 25 and 36)

| Layer | Policy |
|---|---|
| **BotID** | Do **not** call `checkBotId()` in the Go API or web app. Dashboard may show BotID **Basic**; without the server check it does nothing. Never enable **Deep Analysis** (browser challenge). Native `ios|macos` clients cannot pass a BotID challenge; the API must never require one. |
| **Bot Protection** | Managed rule **Off**. |
| **Auth rate limits** | Four custom rules; bucket key is **`ip` + `ja4`** (not IP alone). Same limits as before: sign-up 10/h, prelogin+login 30/10 min, recovery 10/h, email change 10/h. Exceed → edge `rate_limit` (no persistent block). |
| **No header bypass** | Do **not** exempt `X-Dayrule-Client: ios|macos/...` from rate limits. That header is CSRF / client labelling, not proof of a genuine app. |
| **No persistent actions** | Never set `actionDuration` on these rules. A past IP-wide persistent action blocked sync for an hour and survived disabling the rule. |

Per-account login lockout in Postgres is unchanged and still the main
protection against guessing one account.

## Why IP+JA4 (CGNAT)

Carrier-grade NAT shares one public IP across many phones. An IP-only bucket
lets one noisy neighbour exhaust the shared budget and lock everyone on that
IP out of sign-in. JA4 is a TLS client fingerprint Vercel exposes on the edge;
`keys: [ip, ja4]` splits the bucket so most clients on the same IP keep their
own allowance. It is not perfect (some clients share a JA4), but it is safer
for mobile without trusting a spoofable app header.

## Editing live rules

1. Update `scripts/firewall-desired-state.json` in the same change as PLAN.
2. Stage with `vercel firewall rules edit <id> --json '…'` (or flags).
3. Review: `vercel firewall diff`.
4. Publish: `vercel firewall publish --yes`.
5. Confirm: `./scripts/firewall-check.sh`.

Do not load-test Firewall limits against production from a personal or CI
connection (AGENTS.md).

## Related

- PLAN §11.6, §14.1, decisions 12 / 25 / 36
- Native open point 6 closed by apple PLAN decision 25
- Threat model: Availability and abuse
