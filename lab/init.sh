#!/bin/sh
# Generates lab/.env with random lab credentials (once), in Docker.
set -eu
cd "$(dirname "$0")"
[ -f .env ] && { echo "lab/.env exists, keeping it"; exit 0; }
rnd() { docker run --rm node:24.22.1-alpine node -e "process.stdout.write(require('crypto').randomBytes($1).toString('base64url'))"; }
umask 077
{
	echo "ELASTIC_PASSWORD=$(rnd 18)"
	echo "KIBANA_PASSWORD=$(rnd 18)"
	echo "KIBANA_ENCRYPTION_KEY=$(rnd 32)"
} > .env
echo "created lab/.env"
