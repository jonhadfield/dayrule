# Neon restore drill

Prove that production history can be restored into a throwaway branch and
that the API still talks to that copy. Do this after any backup/retention
change, and at least once a year. Never restore over `main` during a drill.

Backups hold only ciphertext and auth hashes (PLAN §14.2). Connection
strings and API tokens stay out of this file and out of chat.

## Project

| | |
|---|---|
| Neon org | Jon (`org-proud-dew-49337551`) |
| Project | `dayrule` (`winter-rice-58610133`) |
| Region | `aws-eu-west-2` |
| History window | 7 days (`history_retention_seconds` = 604800) |
| Production branch | `main` (`br-old-frog-zafxcu4z`) — root; PITR source |
| Other branches | `preview`, `dev` (children of `main`; not PITR sources) |

Auth for the API: a Neon OAuth token from `neonctl` / Console, or a personal
API key in `NEON_API_KEY`. Prefer `neonctl` once logged in.

## Drill (safe: new branch, not overwrite)

1. Pick a timestamp inside the history window (e.g. one hour ago, RFC 3339 UTC).
2. Create a child of `main` at that time, with a read-write endpoint and a short TTL:

   ```bash
   # Requires NEON_API_KEY. Set NAME, TS, EXPIRE yourself.
   curl -sS -X POST \
     "https://console.neon.tech/api/v2/projects/winter-rice-58610133/branches" \
     -H "Authorization: Bearer $NEON_API_KEY" \
     -H "Content-Type: application/json" \
     -d "{
       \"branch\": {
         \"name\": \"$NAME\",
         \"parent_id\": \"br-old-frog-zafxcu4z\",
         \"parent_timestamp\": \"$TS\",
         \"expires_at\": \"$EXPIRE\"
       },
       \"endpoints\": [{ \"type\": \"read_write\" }]
     }"
   ```

   The response includes `branch.id`, `endpoints[0].host`, and
   `connection_uris[0].connection_uri`. Save the URI only in a root-only
   temp file; do not paste it into docs, tickets or chat.

3. Wait until `branch.current_state` is `ready`.
4. Smoke the copy (row counts only — no user content):

   ```sql
   SELECT current_database(), current_setting('server_version');
   SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY 1;
   SELECT
     (SELECT count(*) FROM users) AS users,
     (SELECT count(*) FROM sessions) AS sessions,
     (SELECT count(*) FROM records) AS records,
     (SELECT max(version_id) FROM goose_db_version) AS goose_version;
   ```

5. Point a local `dayruled` at the restore URI (`DATABASE_URL` and
   `DATABASE_URL_UNPOOLED`) with the usual non-DB env from `vercel env pull`
   / `.env.local`, then:

   ```bash
   curl -sS "http://127.0.0.1:$PORT/api/health"
   # expect: {"status":"ok","database":"ok",...}
   ```

   A full browser sign-in against the restore copy is optional; it needs a
   real password and must not be automated with secrets in CI.

6. Delete the branch (or let `expires_at` remove it):

   ```bash
   curl -sS -X DELETE \
     -H "Authorization: Bearer $NEON_API_KEY" \
     "https://console.neon.tech/api/v2/projects/winter-rice-58610133/branches/$BRANCH_ID"
   ```

7. Scrub any temp URI files.

## Real incident (overwrite `main`)

Only when production is wrong and you intend to revert it. Instant restore
on a root branch rewrites that branch; Neon keeps the previous head under
`preserve_under_name`. Prefer a drill-style branch first, confirm the
timestamp with Time Travel Assist / read-only queries, then restore
`main` via Console → Restore or
`POST /projects/.../branches/br-old-frog-zafxcu4z/restore` with
`source_branch_id`, `source_timestamp` and `preserve_under_name`. See
[Neon instant restore](https://neon.com/docs/introduction/branch-restore).

## Last run

| | |
|---|---|
| Date | 2026-10-17 |
| Method | API: child of `main` at `parent_timestamp` ≈ T−1h |
| Branch | `restore-drill-20261017-0956` (deleted after smoke) |
| Checks | Postgres 18 schema present; counts on `users` / `sessions` / `records`; local `GET /api/health` → `database: ok` |
| Result | Pass |
