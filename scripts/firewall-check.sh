#!/usr/bin/env bash
# Compare live Vercel Firewall custom rate-limit rules to scripts/firewall-desired-state.json.
# Requires: vercel CLI logged in to the dayrule project; python3.
# Does not hammer production or change config — read-only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESIRED="$ROOT/scripts/firewall-desired-state.json"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

cd "$ROOT"
vercel firewall rules list --json >"$TMP" 2>/dev/null || {
  # CLI sometimes prints a banner before JSON
  vercel firewall rules list --json 2>&1 | sed -n '/^{/,$p' >"$TMP"
}

python3 - "$DESIRED" "$TMP" <<'PY'
import json, sys

desired_path, live_path = sys.argv[1], sys.argv[2]
with open(desired_path) as f:
    desired = json.load(f)
raw = open(live_path).read()
i = raw.find("{")
if i < 0:
    print("firewall-check: no JSON from vercel firewall rules list", file=sys.stderr)
    sys.exit(2)
live = json.loads(raw[i:])

errors = []

# Managed BotID / bot protection
managed = {m["id"]: m for m in live.get("managed", [])}
for mid, want in desired.get("managed", {}).items():
    m = managed.get(mid)
    if not m:
        errors.append(f"managed {mid}: missing")
        continue
    got = (m.get("action") or "").lower()
    if got != want.lower():
        errors.append(f"managed {mid}: action={got!r} want {want!r}")

by_id = {r["id"]: r for r in live.get("rules", [])}
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
    # No persistent duration on rate limits
    dur = (r.get("action") or {}).get("mitigate", {}).get("actionDuration")
    if dur:
        errors.append(f"{rid}: has actionDuration={dur!r} (forbidden)")

# Extra custom rules not in desired state
want_ids = {w["id"] for w in desired["rules"]}
for rid in by_id:
    if rid not in want_ids:
        errors.append(f"{rid}: live rule not in desired state ({by_id[rid].get('name')})")

if errors:
    print("firewall-check: FAIL")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)

print("firewall-check: OK (%d custom rules, managed bot-id=%s)" % (
    len(desired["rules"]),
    desired["managed"].get("bot-id"),
))
PY
