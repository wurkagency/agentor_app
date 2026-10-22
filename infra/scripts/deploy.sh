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

# Node and PM2 may only live in Plesk's Node.js folder; find them before anything is built or
# migrated, so a missing PM2 can't leave a migrated database behind an unreloaded app.
if ! command -v pm2 >/dev/null; then
  for dir in $(ls -d /opt/plesk/node/*/bin 2>/dev/null | sort -rV); do
    if [ -x "$dir/pm2" ]; then
      export PATH="$dir:$PATH"
      break
    fi
  done
fi
if ! command -v pm2 >/dev/null || ! command -v node >/dev/null; then
  echo "pm2 or node not found. Run server-setup.sh again (it links them into /usr/local/bin),"
  echo "or: npm install -g pm2 && ln -sf \"\$(readlink -f \"\$(command -v pm2)\")\" /usr/local/bin/pm2"
  exit 1
fi
NODE_DIR=$(dirname "$(readlink -f "$(command -v node)")")
export PATH="$NODE_DIR:$PATH"

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
# PostgreSQL 12 has no built-in gen_random_uuid(); server-setup.sh installs pgcrypto in the app
# schema, and app.uuid_v7() must look there. Stop before the switch if IDs can't be made.
if ! psql "$DATABASE_URL_OWNER" -XAtqc 'select app.uuid_v7()' >/dev/null 2>&1; then
  if [ "$(psql "$DATABASE_URL_OWNER" -XAtc "select to_regproc('app.gen_random_uuid') is not null")" = t ]; then
    psql "$DATABASE_URL_OWNER" -Xqc 'alter function app.uuid_v7() set search_path = pg_catalog, app'
  else
    echo "The database can't make IDs: gen_random_uuid() is missing (PostgreSQL older than 13)."
    echo "As the PostgreSQL superuser, in Agentor's database: create extension pgcrypto with schema app;"
    exit 1
  fi
fi
unset DATABASE_URL_OWNER

echo "== Settings"
# Without SMTP_URL no signup code, invitation or receipt reaches anyone (it used to fail silently).
if ! grep -qE '^SMTP_URL=smtps?://.+' "$D/shared/web.env.production"; then
  echo "SMTP_URL is missing in $D/shared/web.env.production, so no e-mail can be sent."
  echo "Add the Brevo SMTP URL (smtp://LOGIN:KEY@smtp-relay.brevo.com:587) and run agentor-deploy again."
  exit 1
fi

# Profile photos go to the storage area (PLAN-2026-10-21 §5.4); agentor-web must be able to write.
STORAGE_DIR=$(grep -E '^STORAGE_DIR=' "$D/shared/web.env.production" | cut -d= -f2-)
if [ -z "$STORAGE_DIR" ] || ! runuser -u agentor-web -- test -w "$STORAGE_DIR"; then
  echo "STORAGE_DIR is missing in web.env.production or not writable by agentor-web."
  echo "Run server-setup.sh again, or: install -d -m 750 -o agentor-web /var/lib/agentor/storage"
  echo "and add STORAGE_DIR=/var/lib/agentor/storage to $D/shared/web.env.production."
  exit 1
fi

echo "== Ports"
# Shared server: refuse to start if another site already listens on Agentor's ports.
for port in 3410 3411; do
  pid=$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)
  if [ -n "$pid" ] && [ "$(ps -o user= -p "$pid" | tr -d ' ')" != agentor-web ]; then
    echo "Port $port is used by another program ($(ps -o user=,comm= -p "$pid")). Free it or change the port in infra/pm2 and infra/plesk."
    exit 1
  fi
done

echo "== Admin commands"
install -m 700 "$R/infra/scripts/superadmin.sh" /usr/local/bin/agentor-superadmin
install -m 700 "$R/infra/scripts/reset-customers.sh" /usr/local/bin/agentor-reset-customers

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
  # Check that it is Agentor answering, not another site on the same server.
  if curl -fsS http://127.0.0.1:3410/login 2>/dev/null | grep -q 'Agentor' &&
     curl -fsS http://127.0.0.1:3411/healthz 2>/dev/null | grep -q '"ok"'; then ok=1; break; fi
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
