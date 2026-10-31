#!/bin/sh
# HTTP-level tenant-isolation and read-only checks against two running portal
# containers (default: compose.yaml on ports 3101 = acme, 3102 = globex).
#
#   scripts/e2e-lab.sh
#
# Sign-in itself happens in the browser at each tenant's Kanidm. These checks use
# sessions signed with the lab's session secrets (secrets/<tenant>/session_secret)
# instead. Needs sh, curl, grep and Docker.
set -u
cd "$(dirname "$0")/.."
A_URL="${A_URL:-http://localhost:3101}"
B_URL="${B_URL:-http://localhost:3102}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

check() { # name expected actual
	if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected $2, got $3)"; FAILS=$((FAILS + 1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
location() { curl -s -o /dev/null -w '%{redirect_url}' "$@"; }
session() { # tenant user -> session cookie, as the portal issues it after sign-in
	docker run --rm -v "$PWD/secrets/$1/session_secret:/secret:ro" node:24.22.1-alpine node -e '
		const crypto = require("crypto");
		const secret = require("fs").readFileSync("/secret", "utf8").trim();
		const [user, tenant] = process.argv.slice(1);
		const exp = Math.floor(Date.now() / 1000) + 600;
		const payload = Buffer.from(JSON.stringify({ user, tenant, exp })).toString("base64url");
		const sig = crypto.createHmac("sha256", secret).update("session." + payload).digest("base64url");
		console.log("portal_session=" + payload + "." + sig);
	' "$2" "$1"
}

A="$(session acme acme.analyst)"
B="$(session globex globex.analyst)"

# --- authentication -----------------------------------------------------------
check "anonymous page redirects to login" 303 "$(code "$A_URL/")"
check "anonymous API is 401" 401 "$(code "$A_URL/api/alerts/x")"
# Data requests get their redirect as JSON; make sure it is a redirect and carries no data.
check "anonymous page data is a redirect" 1 "$(curl -s "$A_URL/detections/__data.json" | grep -c '^{"type":"redirect"')"
check "sign-in goes to the tenant's own Kanidm" 1 "$(location "$A_URL/auth/login" | grep -c '^https://idm-acme\.localhost:8443/')"
check "callback without a pending sign-in goes back to sign-in" "$A_URL/login?error=failed" "$(location "$A_URL/auth/callback?code=x&state=y")"
check "unsigned session is rejected" 303 "$(code -b "portal_session=$(printf '{"user":"x","tenant":"acme","exp":9999999999}' | base64 | tr -d '=').x" "$A_URL/")"
check "POST to the sign-in page is refused" 405 "$(code -X POST -H "Origin: $A_URL" "$A_URL/login")"
check "acme session works on acme" 200 "$(code -b "$A" "$A_URL/")"
check "acme session is rejected by globex container" 303 "$(code -b "$A" "$B_URL/")"
check "cross-site sign-out POST is forbidden" 403 "$(code -X POST -H 'Origin: http://evil.example' -b "$A" "$A_URL/logout")"

# --- collect ids from each tenant ---------------------------------------------
curl -s -b "$A" "$A_URL/detections/__data.json?size=100&range=90d" > "$TMP/a.json"
curl -s -b "$B" "$B_URL/detections/__data.json?size=100&range=90d" > "$TMP/b.json"
curl -s -b "$B" "$B_URL/agents/__data.json?size=100" > "$TMP/b-agents.json"
A_ALERT="$(grep -oE '"[0-9a-f]{64}"' "$TMP/a.json" | head -1 | tr -d '"')"
B_ALERT="$(grep -oE '"[0-9a-f]{64}"' "$TMP/b.json" | head -1 | tr -d '"')"
B_AGENT="$(grep -oE '"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"' "$TMP/b-agents.json" | head -1 | tr -d '"')"
[ -n "$A_ALERT" ] && [ -n "$B_ALERT" ] && [ -n "$B_AGENT" ] || { echo "FAIL  could not collect ids"; exit 1; }

# --- isolation ------------------------------------------------------------------
check "own alert detail is readable" 200 "$(code -b "$A" "$A_URL/api/alerts/$A_ALERT")"
check "other tenant's alert id is 404" 404 "$(code -b "$A" "$A_URL/api/alerts/$B_ALERT")"
check "other tenant's agent page is 404" 404 "$(code -b "$A" "$A_URL/agents/$B_AGENT")"
check "other tenant's agent detections tab is 404" 404 "$(code -b "$A" "$A_URL/agents/$B_AGENT?tab=detections")"
# Results are counted by id pattern (the query itself is echoed back, so names may appear).
check "filtering by another tenant's hostname returns no alerts" 0 \
	"$(curl -s -b "$A" "$A_URL/detections/__data.json?host=GLBX-WS-001&range=90d" | grep -oE '"[0-9a-f]{64}"' | wc -l | tr -d ' ')"
check "crafted space/index/tenant/foreign-policy params return no agents" 0 \
	"$(curl -s -b "$A" "$A_URL/agents/__data.json?space=globex&index=.alerts-security.alerts-*&policy=globex-endpoints&tenant=globex" | grep -oE '"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"' | wc -l | tr -d ' ')"
check "own agents are listed (sanity)" 1 \
	"$(curl -s -b "$A" "$A_URL/agents/__data.json" | grep -qE '"[0-9a-f]{8}-[0-9a-f]{4}-' && echo 1 || echo 0)"
check "acme alert list contains no globex hosts" 0 "$(grep -c 'GLBX\|globex\.example' "$TMP/a.json")"
check "globex alert list contains no acme hosts" 0 "$(grep -c 'ACME-\|acme\.example' "$TMP/b.json")"

# --- read-only ------------------------------------------------------------------
for m in POST PUT PATCH DELETE; do
	check "$m /api/alerts/<id> is refused" 405 "$(code -X "$m" -b "$A" -H "Origin: $A_URL" "$A_URL/api/alerts/$A_ALERT")"
done
check "POST to a page is refused" 405 "$(code -X POST -b "$A" -H "Origin: $A_URL" "$A_URL/detections")"

# --- response hygiene -------------------------------------------------------------
DETAIL="$(curl -s -b "$A" "$A_URL/api/alerts/$A_ALERT")"
check "detail has no raw/internal fields" 0 "$(echo "$DETAIL" | grep -c 'space_ids\|rule.parameters\|execution\.uuid\|_index\|_source')"
check "CSP header present" 1 "$(curl -sI -b "$A" "$A_URL/" | grep -ci '^content-security-policy:')"

echo
[ "$FAILS" -eq 0 ] && echo "All checks passed." || { echo "$FAILS check(s) failed."; exit 1; }
