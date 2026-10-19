#!/usr/bin/env bash
# One-time setup of app.agentor.dk on the Ubuntu/Plesk VM. Idempotent; run as root from the
# Plesk Git checkout:
#
#   PGPASSWORD='<postgres admin password>' SMTP_URL='smtp://…' bash /var/www/vhosts/agentor.dk/app/repo/infra/scripts/server-setup.sh
#
# Optional: PGADMIN_USER (postgres), PGHOST (127.0.0.1), PGPORT (5432), REDIS_URL.
# Secrets are generated here and written only to root/user-owned files with mode 0400; the
# script never prints them. Existing env files are kept (re-running doesn't rotate passwords).
set -euo pipefail

D=/var/www/vhosts/agentor.dk/app
DOMAIN=app.agentor.dk
REPO=$D/repo
: "${PGADMIN_USER:=postgres}" "${PGHOST:=127.0.0.1}" "${PGPORT:=5432}"
: "${REDIS_URL:=redis://127.0.0.1:6379/5}"
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
[ -f "$REPO/package.json" ] || { echo "No checkout in $REPO: deploy it from Plesk → Git first."; exit 1; }
cd /

echo "== Node, pnpm and PM2"
# Plesk installs Node under /opt/plesk/node/<version>/bin, which isn't on root's or sudo's PATH.
if ! command -v node >/dev/null; then
  NODE_DIR=$(ls -d /opt/plesk/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$NODE_DIR" ] || { echo "Node.js not found (install it in Plesk → Node.js)."; exit 1; }
  export PATH="$NODE_DIR:$PATH"
fi
NODE_DIR=$(dirname "$(readlink -f "$(command -v node)")")
export PATH="$NODE_DIR:$PATH"
command -v pnpm >/dev/null || npm install -g pnpm@12.14.0
command -v pm2 >/dev/null || npm install -g pm2
# Make them visible to sudo and to the service users.
for b in node npm npx pnpm pm2; do
  p=$(readlink -f "$(command -v $b)")
  [ "$p" = "/usr/local/bin/$b" ] || ln -sf "$p" "/usr/local/bin/$b"
done
echo "node $(node -v) · pnpm $(pnpm -v)"

echo "== Service users and folders"
id -u agentor-web >/dev/null 2>&1 || useradd -r -m -d /var/lib/agentor-web -s /usr/sbin/nologin agentor-web
id -u agentor-worker >/dev/null 2>&1 || useradd -r -m -d /var/lib/agentor-worker -s /usr/sbin/nologin agentor-worker
mkdir -p "$D/releases" "$D/shared" /etc/agentor
chmod 755 "$D" "$D/releases" "$D/shared"
chown agentor-worker /etc/agentor && chmod 700 /etc/agentor

if [ -f "$D/shared/deploy.env" ]; then
  echo "== Env files exist, keeping them (delete $D/shared/*.env* to start over)"
else
  [ -n "${PGPASSWORD:-}" ] || { echo "Set PGPASSWORD to the Postgres admin password."; exit 1; }
  [ -n "${SMTP_URL:-}" ] || { echo "Set SMTP_URL, e.g. smtp://user%40domain:key@smtp-relay.brevo.com:587"; exit 1; }
  export PGPASSWORD

  echo "== Database roles and database"
  pw() { openssl rand -hex 24; }
  PW_OWNER=$(pw); PW_WEB=$(pw); PW_WORKER=$(pw); PW_SUPPORT=$(pw); PW_OPS=$(pw)
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGADMIN_USER" -d postgres -q \
    -v owner_password="$PW_OWNER" -v web_password="$PW_WEB" -v worker_password="$PW_WORKER" \
    -v support_password="$PW_SUPPORT" -v ops_password="$PW_OPS" -v db_name=agentor \
    -f "$REPO/infra/db/roles.sql"
  url() { echo "postgresql://$1:$2@$PGHOST:$PGPORT/agentor"; }

  echo "== Key encryption key"
  KEK=/etc/agentor/kek.pem
  KEK_PUBLIC_KEY=$(node "$REPO/infra/scripts/dev-kek.mjs" "$KEK" | sed -n 's/^KEK_PUBLIC_KEY=//p')
  chown agentor-worker "$KEK" && chmod 400 "$KEK"

  echo "== Env files"
  AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  common() {
    printf '%s\n' "APP_URL=https://$DOMAIN" "REDIS_URL=$REDIS_URL" "BETTER_AUTH_SECRET=$AUTH_SECRET" \
      "SMTP_URL=$SMTP_URL" "CONNECTOR_MODE=mock" "QUICKPAY_MODE=mock" "CVR_PROVIDER=fixture" \
      "INGEST_PUBLIC_URL=https://$DOMAIN" "INGEST_INTERNAL_URL=http://127.0.0.1:3100" "LOG_LEVEL=info"
  }
  umask 077
  { common; echo "DATABASE_URL_WEB=$(url agentor_web "$PW_WEB")"; echo "KEK_PUBLIC_KEY=$KEK_PUBLIC_KEY"; } > "$D/shared/web.env.production"
  { common; echo "DATABASE_URL_WORKER=$(url agentor_worker "$PW_WORKER")"; echo "KEK_FILE=$KEK"; } > "$D/shared/worker.env.production"
  echo "DATABASE_URL_OWNER=$(url agentor_owner "$PW_OWNER")" > "$D/shared/deploy.env"
  umask 022
  chown agentor-web "$D/shared/web.env.production"
  chown agentor-worker "$D/shared/worker.env.production"
  chmod 400 "$D/shared/"*.env*
fi

echo "== nginx directives for $DOMAIN"
if plesk bin domain --update-web-server-settings "$DOMAIN" -nginx-proxy-mode false \
     -additional-nginx-settings-file "$REPO/infra/plesk/nginx-directives.conf"; then
  echo "nginx updated"
else
  echo "Plesk refused the nginx settings: paste infra/plesk/nginx-directives.conf into"
  echo "Plesk → $DOMAIN → Apache & nginx Settings → Additional nginx directives, and turn Proxy mode off."
fi

echo "== Deploy commands and PM2 at boot"
install -m 700 "$REPO/infra/scripts/deploy.sh" /usr/local/bin/agentor-deploy
install -m 700 "$REPO/infra/scripts/rollback.sh" /usr/local/bin/agentor-rollback
for u in agentor-web agentor-worker; do
  pm2 startup systemd -u "$u" --hp "/var/lib/$u" >/dev/null || echo "Warning: pm2 startup for $u failed; PM2 won't start at boot."
done

echo "Done. Next: agentor-deploy"
