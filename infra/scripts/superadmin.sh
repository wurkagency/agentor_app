#!/usr/bin/env bash
# Creates or updates a Superadmin on the server, like the local one: the login (password typed
# at a hidden prompt) and the Superadmin role. Installed as /usr/local/bin/agentor-superadmin by
# deploy.sh. Run as root:  agentor-superadmin charlie@wurk.dk "Charlie Nielsen"
set -euo pipefail

D=/var/www/vhosts/agentor.dk/app
if [ "$#" -ne 2 ]; then
  echo 'Usage: agentor-superadmin <email> "<name>"'
  exit 1
fi
export PATH="/usr/local/bin:$PATH"
cd "$D/current/apps/web"
SUPERADMIN_EMAIL="$1" SUPERADMIN_NAME="$2" node \
  --env-file="$D/shared/web.env.production" \
  --env-file="$D/shared/deploy.env" \
  --import tsx scripts/create-superadmin.ts
