#!/bin/sh
# Lab setup for the two demo tenants, run in Docker:
#   secrets/<tenant>/session_secret       random 32-byte secret
#   secrets/<tenant>/idm-tls/             the tenant Kanidm's self-signed lab CA and certificate
#   secrets/<tenant>/oidc_client_secret   the portal's client secret at that Kanidm
# In each tenant's Kanidm it sets up the portal's OAuth2 client, the group
# portal_users and a demo user <tenant>.analyst, shows the customer's name and
# the portal's logo on its pages, then prints a sign-up link for
# the demo user (valid 24 hours). Acme's client also accepts the development
# server on port 5173 (see README, Development). Run it again for fresh links;
# existing secrets and Kanidm entries are kept.
set -eu
cd "$(dirname "$0")/.."
NODE_IMAGE="node:24.22.1-alpine"

for tenant in acme globex; do
	case "$tenant" in
	acme) name="Acme" org="Acme Corp" idm_port=8443 portal="http://localhost:3101" dev="http://localhost:5173" ;;
	globex) name="Globex" org="Globex Inc" idm_port=8444 portal="http://localhost:3102" dev="" ;;
	esac
	idm="idm-$tenant"
	dir="secrets/$tenant"
	mkdir -p "$dir/idm-tls"
	chmod 700 "$dir"
	if [ ! -f "$dir/session_secret" ]; then
		docker run --rm "$NODE_IMAGE" node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" > "$dir/session_secret"
		echo "created $dir/session_secret"
	fi
	if [ ! -f "$dir/idm-tls/chain.pem" ]; then
		docker compose run --rm --no-deps "$idm" kanidmd cert-generate > /dev/null 2>&1
		echo "created $dir/idm-tls (lab CA and certificate for $idm.localhost)"
	fi
	docker compose up -d "$idm" 2> /dev/null
	recover() { docker compose exec -T "$idm" kanidmd recover-account "$1" 2>&1 | sed -n 's/.*new_password: "\(.*\)".*/\1/p'; }
	idm_admin_password="$(recover idm_admin)"
	admin_password="$(recover admin)"

	out="$(docker compose run --rm -T --no-deps \
		-v "$PWD/$dir/idm-tls:/tls:ro" -v "$PWD/kanidm/logo.svg:/logo.svg:ro" \
		-e KANIDM_URL="https://$idm.localhost:$idm_port" -e KANIDM_CA_PATH=/tls/ca.pem \
		-e KANIDM_NAME=idm_admin -e KANIDM_PASSWORD="$idm_admin_password" -e ADMIN_PASSWORD="$admin_password" \
		-e TENANT="$tenant" -e NAME="$name" -e ORG="$org" -e PORTAL="$portal" -e DEV="$dev" \
		idm-cli -s 2> /dev/null << 'EOF'
set -e
tries=0
until kanidm login > /dev/null 2>&1; do
	tries=$((tries + 1)); [ "$tries" -lt 30 ] || { echo "Kanidm did not come up" >&2; exit 1; }
	sleep 1
done
client="portal-$TENANT"
user="$TENANT.analyst"
kanidm group get portal_users | grep -q '^name: ' || kanidm group create portal_users > /dev/null
if ! kanidm person get "$user" | grep -q '^name: '; then
	kanidm person create "$user" "$NAME Analyst" > /dev/null
	kanidm group add-members portal_users "$user" > /dev/null
fi
if ! kanidm system oauth2 get "$client" | grep -q '^name: '; then
	kanidm system oauth2 create "$client" "$NAME Defend Portal" "$PORTAL" > /dev/null
	kanidm system oauth2 add-redirect-url "$client" "$PORTAL/auth/callback" > /dev/null
	kanidm system oauth2 update-scope-map "$client" portal_users openid profile groups > /dev/null
	kanidm system oauth2 prefer-short-username "$client" > /dev/null
	kanidm system oauth2 disable-consent-prompt "$client" > /dev/null
fi
kanidm system oauth2 set-image "$client" /logo.svg > /dev/null
[ -z "$DEV" ] || kanidm system oauth2 add-redirect-url "$client" "$DEV/auth/callback" > /dev/null
# For now, a password alone is enough to sign in. Kanidm's default asks for MFA or a passkey.
kanidm group account-policy credential-type-minimum idm_all_persons any > /dev/null
# The domain's name and image need Kanidm's admin account.
KANIDM_PASSWORD="$ADMIN_PASSWORD" kanidm login -D admin > /dev/null
kanidm system domain set-displayname -D admin "$ORG" > /dev/null
kanidm system domain set-image -D admin /logo.svg > /dev/null
echo "secret: $(kanidm system oauth2 show-basic-secret "$client")"
echo "link: $(kanidm person credential create-reset-token "$user" --ttl 86400 | grep -o 'https://[^ ]*/ui/reset?token=[^ ]*' | head -1)"
EOF
	)"
	secret="$(echo "$out" | sed -n 's/^secret: //p')"
	link="$(echo "$out" | sed -n 's/^link: //p')"
	[ -n "$secret" ] && [ -n "$link" ] || { echo "Kanidm setup for $tenant failed"; exit 1; }
	if [ ! -f "$dir/oidc_client_secret" ] || [ "$(cat "$dir/oidc_client_secret")" != "$secret" ]; then
		printf '%s\n' "$secret" > "$dir/oidc_client_secret"
		echo "wrote $dir/oidc_client_secret"
	fi
	# The portal runs as uid 1000 (node); its secrets must be readable by it.
	chmod 644 "$dir/session_secret" "$dir/oidc_client_secret"
	echo "$tenant.analyst: choose a password at $link"
done
