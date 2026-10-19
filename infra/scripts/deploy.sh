#!/usr/bin/env bash
# Builds the Plesk Git checkout into a new release, migrates, switches `current` and reloads
# PM2 for both service users (produktspecifikation §10.5). Installed as /usr/local/bin/agentor-deploy
# by server-setup.sh; run as root after each pull in Plesk.
set -euo pipefail
trap 'echo "Deploy failed at line $LINENO (see the output above)."' ERR

D=/var/www/vhosts/agentor.dk/app
R=$D/releases/$(date +%Y%m%d%H%M%S)
export PATH="/usr/local/bin:$PATH"
cd /

echo "== Release $R"
cp -a "$D/repo" "$R"
cd "$R"
pnpm install --frozen-lockfile
pnpm build

echo "== Migrations"
set -a
. "$D/shared/deploy.env"
set +a
pnpm db:migrate
unset DATABASE_URL_OWNER

echo "== Switch and reload"
chown -R root:root "$R" && chmod -R a+rX "$R"
ln -sfn "$R" "$D/current"
as() { sudo -u "$1" -H env PATH="$PATH" "${@:2}"; }
as agentor-web pm2 startOrReload "$D/current/infra/pm2/ecosystem.web.config.cjs" --env production
as agentor-worker pm2 startOrReload "$D/current/infra/pm2/ecosystem.worker.config.cjs" --env production
as agentor-web pm2 save >/dev/null
as agentor-worker pm2 save >/dev/null

echo "== Health"
ok=0
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/login && curl -fsS -o /dev/null http://127.0.0.1:3100/healthz; then ok=1; break; fi
  sleep 3
done
if [ "$ok" != 1 ]; then
  echo "Health check failed. Logs: sudo -u agentor-web -H pm2 logs --lines 50 --nostream"
  echo "Undo with: agentor-rollback"
  exit 1
fi
echo "web and ingest ok"

# Keep the five newest releases.
ls -1d "$D"/releases/* | sort | head -n -5 | xargs -r rm -rf
echo "Deployed $R"
