#!/usr/bin/env bash
# One-time setup of app.agentor.dk on the Ubuntu/Plesk VM. Idempotent; run as root from the
# Plesk Git checkout:
#
#   bash /var/www/vhosts/agentor.dk/app/repo/infra/scripts/server-setup.sh
#
# No Postgres password is needed: as root it uses the local socket (see open_admin). Optional:
# DB_NAME (agentor_application, the empty database made in Plesk), SMTP_URL, REDIS_URL, PGPORT,
# or PGPASSWORD + PGADMIN_USER + PGHOST to log in as an admin over the network instead.
# Secrets are generated here and written only to root/user-owned files with mode 0400; the
# script never prints them. Existing env files are kept (re-running doesn't rotate passwords).
set -euo pipefail

D=/var/www/vhosts/agentor.dk/app
DOMAIN=app.agentor.dk
REPO=$D/repo
: "${PGADMIN_USER:=postgres}" "${PGHOST:=127.0.0.1}" "${PGPORT:=5432}"
: "${REDIS_URL:=redis://127.0.0.1:6379/5}" "${DB_NAME:=agentor_application}"
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
# Plesk keeps the vhost folder at 0710 for its own group; the service users only need to pass
# through it (traverse, no listing or reading) to reach app/current and app/shared.
VHOST=$(dirname "$D")
if command -v setfacl >/dev/null; then
  setfacl -m u:agentor-web:x,u:agentor-worker:x "$VHOST"
else
  usermod -aG "$(stat -c %G "$VHOST")" agentor-web && usermod -aG "$(stat -c %G "$VHOST")" agentor-worker
fi
runuser -u agentor-web -- test -x "$D" || { echo "agentor-web can't reach $D; check the permissions on $VHOST."; exit 1; }

# ---- Postgres as admin ---------------------------------------------------------------------
# Without PGPASSWORD the script uses the local socket as the postgres system user, so no admin
# password is needed. Plesk's pg_hba.conf asks for a password there too, so one "peer" line is
# added for the duration of the script and the original file is put back afterwards.
PG_HBA="" PG_VER=""
pg_reload() { systemctl reload postgresql 2>/dev/null || pg_ctlcluster "$PG_VER" main reload; }
restore_hba() {
  if [ -n "$PG_HBA" ] && [ -f "$PG_HBA.agentor-bak" ]; then
    mv -f "$PG_HBA.agentor-bak" "$PG_HBA" && pg_reload && echo "pg_hba.conf restored"
  fi
}
local_psql() { runuser -u postgres -- psql -w -X -p "$PGPORT" -v ON_ERROR_STOP=1 "$@"; }
admin_psql() {
  if [ -n "${PGPASSWORD:-}" ]; then psql -w -X -h "$PGHOST" -p "$PGPORT" -U "$PGADMIN_USER" -v ON_ERROR_STOP=1 "$@"
  else local_psql "$@"; fi
}
open_admin() {
  if [ -n "${PGPASSWORD:-}" ]; then
    export PGPASSWORD
    admin_psql -d postgres -tAc "select 1" >/dev/null ||
      { echo "Can't log in as $PGADMIN_USER. Unset PGPASSWORD (unset PGPASSWORD) to use the local socket instead."; exit 1; }
    return
  fi
  local_psql -d postgres -tAc "select 1" >/dev/null 2>&1 && return
  PG_HBA=$(ls /etc/postgresql/*/main/pg_hba.conf 2>/dev/null | sort -V | tail -1)
  [ -n "$PG_HBA" ] || { echo "pg_hba.conf not found under /etc/postgresql. Is PostgreSQL installed on this server?"; exit 1; }
  PG_VER=$(basename "$(dirname "$(dirname "$PG_HBA")")")
  cp -p "$PG_HBA" "$PG_HBA.agentor-bak"
  trap restore_hba EXIT
  sed -i '1i local all postgres peer' "$PG_HBA"
  pg_reload
  sleep 1
  local_psql -d postgres -tAc "select 1" >/dev/null ||
    { echo "Still can't reach Postgres through the local socket on port $PGPORT."; exit 1; }
}

# The app logs in over 127.0.0.1 with passwords; make sure pg_hba.conf lets the Agentor roles in.
check_app_login() {
  local url=$1
  psql -w -X "$url" -tAc "select 1" >/dev/null 2>&1 && return
  local hba
  hba=$(ls /etc/postgresql/*/main/pg_hba.conf 2>/dev/null | sort -V | tail -1)
  [ -n "$hba" ] || { echo "The app can't log in to Postgres over 127.0.0.1 and pg_hba.conf wasn't found."; exit 1; }
  PG_VER=$(basename "$(dirname "$(dirname "$hba")")")
  grep -q "agentor_owner,agentor_web" "$hba" ||
    sed -i "1i host $DB_NAME agentor_owner,agentor_web,agentor_worker,agentor_support,agentor_readonly_ops 127.0.0.1/32 md5" "$hba"
  pg_reload
  sleep 1
  psql -w -X "$url" -tAc "select 1" >/dev/null ||
    { echo "The app still can't log in to Postgres on 127.0.0.1:$PGPORT. Check listen_addresses in postgresql.conf."; exit 1; }
}

ENV_OK=0
if [ -f "$D/shared/deploy.env" ]; then
  OWNER_URL=$(sed -n 's/^DATABASE_URL_OWNER=//p' "$D/shared/deploy.env")
  if psql -w -X "$OWNER_URL" -tAc "select 1" >/dev/null 2>&1; then ENV_OK=1; fi
fi

if [ "$ENV_OK" = 1 ]; then
  echo "== Env files exist and the database login works, keeping them"
else
  [ -n "${SMTP_URL:-}" ] || echo "Note: SMTP_URL not set; e-mail (verification, invitations) stays off until you add it to the env files."

  echo "== Database roles and database $DB_NAME"
  open_admin
  pw() { openssl rand -hex 24; }
  PW_OWNER=$(pw); PW_WEB=$(pw); PW_WORKER=$(pw); PW_SUPPORT=$(pw); PW_OPS=$(pw)
  # Root reads the file and pipes it in: the postgres user can't enter the Plesk vhost folder.
  admin_psql -d postgres -q \
    -v owner_password="$PW_OWNER" -v web_password="$PW_WEB" -v worker_password="$PW_WORKER" \
    -v support_password="$PW_SUPPORT" -v ops_password="$PW_OPS" -v db_name="$DB_NAME" \
    -f - < "$REPO/infra/db/roles.sql"
  restore_hba
  trap - EXIT
  url() { echo "postgresql://$1:$2@$PGHOST:$PGPORT/$DB_NAME"; }
  check_app_login "$(url agentor_owner "$PW_OWNER")"
  echo "database ok"

  echo "== Key encryption key"
  KEK=/etc/agentor/kek.pem
  KEK_PUBLIC_KEY=$(node "$REPO/infra/scripts/dev-kek.mjs" "$KEK" | sed -n 's/^KEK_PUBLIC_KEY=//p')
  chown agentor-worker "$KEK" && chmod 400 "$KEK"

  echo "== Env files"
  AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  common() {
    printf '%s\n' "APP_URL=https://$DOMAIN" "REDIS_URL=$REDIS_URL" "BETTER_AUTH_SECRET=$AUTH_SECRET" \
      "CONNECTOR_MODE=mock" "QUICKPAY_MODE=mock" "CVR_PROVIDER=fixture" \
      "INGEST_PUBLIC_URL=https://$DOMAIN" "INGEST_INTERNAL_URL=http://127.0.0.1:3411" "LOG_LEVEL=info"
    # Only when given: an empty value is invalid, and without it mail goes nowhere.
    if [ -n "${SMTP_URL:-}" ]; then echo "SMTP_URL=$SMTP_URL"; fi
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

# nginx: this Plesk version has no CLI option for additional directives; they are pasted in the
# UI once (Apache & nginx Settings, Proxy mode off) from infra/plesk/nginx-directives.conf.

echo "== Deploy commands and PM2 at boot"
install -m 700 "$REPO/infra/scripts/deploy.sh" /usr/local/bin/agentor-deploy
install -m 700 "$REPO/infra/scripts/rollback.sh" /usr/local/bin/agentor-rollback
for u in agentor-web agentor-worker; do
  pm2 startup systemd -u "$u" --hp "/var/lib/$u" >/dev/null || echo "Warning: pm2 startup for $u failed; PM2 won't start at boot."
done

echo "Done. Next: agentor-deploy, and paste infra/plesk/nginx-directives.conf into Plesk → $DOMAIN → Apache & nginx Settings (Proxy mode off) if not done yet."
