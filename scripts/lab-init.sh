#!/bin/sh
# Generates lab-only secrets for the two demo tenants (uses Docker, not host Node).
#   secrets/<tenant>/session_secret   random 32-byte secret
#   secrets/<tenant>/users.json       one demo user with a scrypt hash
# Existing files are left untouched. Demo passwords are printed once.
set -eu
cd "$(dirname "$0")/.."
NODE_IMAGE="node:24.22.1-alpine"

gen() {
	docker run --rm -v "$PWD/scripts:/s:ro" "$NODE_IMAGE" node -e "$1" "$2" 2>/dev/null
}

for tenant in acme globex; do
	dir="secrets/$tenant"
	mkdir -p "$dir"
	chmod 700 "$dir"
	if [ ! -f "$dir/session_secret" ]; then
		gen "console.log(require('crypto').randomBytes(32).toString('base64url'))" "" > "$dir/session_secret"
		echo "created $dir/session_secret"
	fi
	if [ ! -f "$dir/users.json" ]; then
		user="$tenant.analyst"
		pass="$(gen "console.log(require('crypto').randomBytes(12).toString('base64url'))" "")"
		hash="$(docker run --rm -v "$PWD/scripts:/s:ro" "$NODE_IMAGE" node /s/hash-password.mjs "$pass")"
		printf '{ "%s": "%s" }\n' "$user" "$hash" > "$dir/users.json"
		echo "created $dir/users.json  ->  user: $user  password: $pass"
	fi
	# The container runs as uid 1000 (node); secrets must be readable by it.
	chmod 644 "$dir/session_secret" "$dir/users.json"
done
