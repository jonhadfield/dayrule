# Dayrule CLI / MCP

A local companion that manages to-dos through the same encrypted sync API as
the web and Apple apps. Cursor (or any MCP client) talks to the process over
stdio; the process signs in, decrypts in memory, and pushes ciphertext. The
server never sees titles or notes.

## Build

```bash
cd server
go build -o dayrule ./cmd/dayrule
```

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `DAYRULE_CREDS` | preferred | File with email on line 1, password on line 2 (avoids shell escaping) |
| `DAYRULE_EMAIL` | or this | Account email |
| `DAYRULE_PASSWORD` | or this | Password (CLI trims surrounding whitespace) |
| `DAYRULE_API` | no | Origin (default `https://dayrule.app`) |
| `DAYRULE_TOTP_SECRET` | if two-step | Base32 authenticator secret; CLI mints the current code |
| `DAYRULE_TOTP_CODE` | or this | One 6-digit code (useful in tests) |
| `DAYRULE_BACKUP_CODE` | or this | One unused backup code |

`bad_login` is returned **before** any two-step check. It only means the
email/password pair did not match (unknown email uses the same message).
Confirm the same pair unlocks the vault on dayrule.app, then:

```bash
mkdir -p ~/.config/dayrule
# line 1 = email, line 2 = password
nano ~/.config/dayrule/creds && chmod 600 ~/.config/dayrule/creds
export DAYRULE_CREDS=$HOME/.config/dayrule/creds
./dayrule doctor
```

Accounts with two-step sign-in need a TOTP secret/code or a backup code in the
environment (passkeys are not supported in the CLI). Prefer a dedicated agent
account with an authenticator app, or turn two-step off for that account.

## CLI

```bash
export DAYRULE_EMAIL=…
export DAYRULE_PASSWORD=…
./dayrule inbox
./dayrule today
./dayrule backlog
./dayrule scheduled
./dayrule add "Buy milk"
./dayrule schedule "Buy milk"
./dayrule complete "Buy milk"
./dayrule cancel "Buy milk"
```

## Cursor MCP

There is no Marketplace plugin or skill yet — wire the binary as a local MCP
server. Global config (`~/.cursor/mcp.json`) is usually right so Dayrule tools
work in every chat:

```json
{
  "mcpServers": {
    "dayrule": {
      "command": "/Users/YOU/Repositories/dayrule/server/dayrule",
      "args": ["mcp"],
      "env": {
        "DAYRULE_CREDS": "/Users/YOU/.config/dayrule/creds"
      }
    }
  }
}
```

Use the absolute path to the binary you built (`go build -o dayrule ./cmd/dayrule`
in `server/`). Point `DAYRULE_CREDS` at the same file `doctor` used. Do not put
the password in `mcp.json`.

Then: **Cursor Settings → MCP** → confirm `dayrule` is enabled (restart Cursor
if it was already open). In chat, ask things like “what's on Today in Dayrule?”
or “add Buy milk to my Inbox” — the agent should call `list_today` / `add_todo`.

An optional Cursor skill can teach vocabulary later; it is not required for the
tools to work.

### Tools

| Tool | Action |
|---|---|
| `list_inbox` | Open Inbox to-dos |
| `list_today` | Open Today to-dos |
| `list_backlog` | Open Backlog to-dos (anytime and Not now) |
| `list_scheduled` | Open Scheduled to-dos (When after today) |
| `add_todo` | Create an Inbox to-do |
| `schedule_todo` | Put on Today by id or exact title |
| `complete_todo` | Complete by id or exact title |
| `cancel_todo` | Cancel by id or exact title |

## How it syncs

Same as any other device: `prelogin` → `login` (native bearer via
`X-Dayrule-Client: macos/99999`) → unwrap account key → `sync/pull` /
`sync/push`. Web and native apps pick up changes on their next poll.
