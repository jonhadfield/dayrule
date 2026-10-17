# Uptime check

Production exposes `GET /api/health` (no auth). It pings Neon and returns:

```json
{"status":"ok","database":"ok","version":"<git sha prefix>"}
```

| HTTP | Meaning |
|---|---|
| 200 + `status=ok`, `database=ok` | App and database reachable |
| 503 + `status=degraded`, `database=unavailable` | App up, Neon ping failed |
| 200 + `database=unconfigured` | Local/dev without a database (not production) |

## External probe

GitHub Actions workflow `.github/workflows/uptime.yml` runs
`scripts/uptime-check.sh` against `https://dayrule.app` about every 15 minutes
(and on demand via **Actions → Uptime → Run workflow**). That is outside
Vercel’s network, so a regional outage or a bad deploy shows up even when
you can still open the Vercel dashboard.

**Alert:** a failed run emails people watching the repo who have **GitHub →
Settings → Notifications → Actions** failure emails on (or the org equivalent).
There is no public status page yet.

Local check:

```bash
./scripts/uptime-check.sh
./scripts/uptime-check.sh https://preview.dayrule.app   # optional; preview may sleep
```

Do not point this at auth endpoints or hammer Firewall-limited routes.
