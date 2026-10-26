#!/usr/bin/env bash
# Points `current` at the previous release and reloads PM2. Database migrations are not undone
# (they only add tables and columns). Installed as /usr/local/bin/agentor-rollback.
set -euo pipefail

D=/var/www/vhosts/agentor.dk/app
export PATH="/usr/local/bin:$PATH"
cd /
NOW=$(readlink -f "$D/current")
PREV=$(ls -1d "$D"/releases/* | sort | grep -B1 -x "$NOW" | head -1)
[ -n "$PREV" ] && [ "$PREV" != "$NOW" ] || { echo "No earlier release than $NOW."; exit 1; }
ln -sfn "$PREV" "$D/current"
sudo -u agentor-web -H env PATH="$PATH" pm2 reload all
sudo -u agentor-worker -H env PATH="$PATH" pm2 reload all
echo "Rolled back to $PREV"
