#!/usr/bin/env bash
# Compare live Vercel Firewall custom rate-limit rules to
# scripts/firewall-desired-state.json (PLAN decision 36).
#
# Uses the REST API (not `vercel firewall`), so project-scoped `vcp_` tokens
# work: the CLI's "retrieve Project Settings" step fails for those tokens.
#
# Auth: VERCEL_TOKEN (required in CI). Locally you can export a token or rely
# on the CLI session by leaving VERCEL_TOKEN unset and setting
# FIREWALL_CHECK_USE_CLI=1 (legacy path).
#
# Project: VERCEL_PROJECT_ID (or -- defaults to dayrule's id).
# Team: VERCEL_ORG_ID (optional for vcp_ tokens; required for full-account).
#
# Read-only — does not publish or probe auth endpoints.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESIRED="$ROOT/scripts/firewall-desired-state.json"
PROJECT_ID="${VERCEL_PROJECT_ID:-prj_XVcM86lwSTWYcO9PmY92Sr2oSA2M}"
ORG_ID="${VERCEL_ORG_ID:-${VERCEL_SCOPE:-team_AXC12tymJdKVL5rUqyer2xcR}}"

if [[ "${FIREWALL_CHECK_USE_CLI:-}" == "1" ]]; then
  echo "firewall-check: FIREWALL_CHECK_USE_CLI is no longer supported; use the REST path." >&2
  exit 2
fi

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  # Fall back to the logged-in CLI token without printing it.
  AUTH_JSON="${VERCEL_AUTH_JSON:-$HOME/Library/Application Support/com.vercel.cli/auth.json}"
  if [[ -f "$AUTH_JSON" ]]; then
    VERCEL_TOKEN="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['token'])" "$AUTH_JSON")"
    export VERCEL_TOKEN
  fi
fi
if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "firewall-check: set VERCEL_TOKEN (project-scoped vcp_ token preferred)." >&2
  exit 2
fi

python3 - "$DESIRED" "$PROJECT_ID" "$ORG_ID" <<'PY'
import json, sys, urllib.error, urllib.parse, urllib.request

desired_path, project_id, org_id = sys.argv[1], sys.argv[2], sys.argv[3]
token = __import__("os").environ["VERCEL_TOKEN"]

with open(desired_path) as f:
    desired = json.load(f)

def get(path: str):
    req = urllib.request.Request(
        "https://api.vercel.com" + path,
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return None, f"HTTP {e.code} {path}: {body[:300]}"

q = urllib.parse.urlencode({"projectId": project_id, "teamId": org_id})
cfg, err = get(f"/v1/security/firewall/config?{q}")
if err:
    # Project tokens often omit teamId.
    q2 = urllib.parse.urlencode({"projectId": project_id})
    cfg, err2 = get(f"/v1/security/firewall/config?{q2}")
    if err2:
        print("firewall-check: failed to read firewall config", file=sys.stderr)
        print(f"  - {err}", file=sys.stderr)
        print(f"  - {err2}", file=sys.stderr)
        sys.exit(2)

active = cfg.get("active") or {}
rules = active.get("rules") or []
errors = []

by_id = {r["id"]: r for r in rules}
for want in desired["rules"]:
    rid = want["id"]
    r = by_id.get(rid)
    if not r:
        errors.append(f"{rid}: missing live rule")
        continue
    if not r.get("active", True):
        errors.append(f"{rid}: inactive")
    rl = (r.get("action") or {}).get("mitigate", {}).get("rateLimit") or {}
    wrl = want["rateLimit"]
    if sorted(rl.get("keys") or []) != sorted(wrl["keys"]):
        errors.append(f"{rid}: keys={rl.get('keys')} want {wrl['keys']}")
    for field in ("limit", "window", "algo"):
        if rl.get(field) != wrl.get(field):
            errors.append(f"{rid}: {field}={rl.get(field)!r} want {wrl.get(field)!r}")
    if rl.get("action") != wrl.get("action"):
        errors.append(f"{rid}: exceed action={rl.get('action')!r} want {wrl.get('action')!r}")
    dur = (r.get("action") or {}).get("mitigate", {}).get("actionDuration")
    if dur:
        errors.append(f"{rid}: has actionDuration={dur!r} (forbidden)")

want_ids = {w["id"] for w in desired["rules"]}
for rid, r in by_id.items():
    if rid not in want_ids:
        errors.append(f"{rid}: live rule not in desired state ({r.get('name')})")

# Managed bots live on the project resource (not the firewall config payload).
managed_got = {}
proj, perr = get(f"/v9/projects/{urllib.parse.quote(project_id)}?{urllib.parse.urlencode({'teamId': org_id})}")
if perr:
    proj, perr2 = get(f"/v9/projects/{urllib.parse.quote(project_id)}")
    perr = perr if proj is None else None
if proj is None:
    errors.append(
        "managed bots: cannot read project settings "
        f"({perr or perr2}). Use a team-scoped token, or ignore if only "
        "rate-limit rules matter."
    )
else:
    sec = proj.get("security") or {}
    mr = sec.get("managedRules") or {}
    # Map API → desired ids (matches `vercel firewall rules list` labels).
    managed_got["bot-protection"] = "off" if not (mr.get("bot_filter") or {}).get("active") else "on"
    # Inactive AI bot filter ≈ allow; active without challenge ≈ log/block — we want allow.
    managed_got["ai-bots"] = "allow" if not (mr.get("ai_bots") or {}).get("active") else "block"
    # Dashboard "BotID Basic" with no in-app checkBotId is the desired noop.
    # botIdEnabled true would mean a stronger mode; treat false as basic.
    managed_got["bot-id"] = "deep" if sec.get("botIdEnabled") else "basic"

    for mid, want in desired.get("managed", {}).items():
        got = managed_got.get(mid)
        if got is None:
            errors.append(f"managed {mid}: missing")
        elif got.lower() != want.lower():
            errors.append(f"managed {mid}: action={got!r} want {want!r}")

if errors:
    print("firewall-check: FAIL")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)

print(
    "firewall-check: OK (%d custom rules, managed bot-id=%s)"
    % (len(desired["rules"]), managed_got.get("bot-id") or desired["managed"].get("bot-id"))
)
PY
