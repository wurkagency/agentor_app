#!/usr/bin/env bash
# Deletes every customer and every login except one Super Administrator (apps/web/scripts/
# reset-customers.ts). A dry run unless --delete is given; then it asks for the e-mail once more.
# Installed as /usr/local/bin/agentor-reset-customers by deploy.sh. Run as root:
#   agentor-reset-customers charlie@wurk.dk            (shows what would be deleted)
#   agentor-reset-customers charlie@wurk.dk --delete   (deletes)
set -euo pipefail

D=/var/www/vhosts/agentor.dk/app
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || { [ "$#" -eq 2 ] && [ "$2" != "--delete" ]; }; then
  echo 'Usage: agentor-reset-customers <e-mail to keep> [--delete]'
  exit 1
fi
export PATH="/usr/local/bin:$PATH"
cd "$D/current/apps/web"
RESET_KEEP_EMAIL="$1" RESET_DELETE="$([ "${2:-}" = "--delete" ] && echo 1 || echo 0)" node \
  --env-file="$D/shared/web.env.production" \
  --env-file="$D/shared/deploy.env" \
  --import tsx scripts/reset-customers.ts
