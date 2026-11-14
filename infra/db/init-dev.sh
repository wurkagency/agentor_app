#!/bin/sh
# Runs once when the local Postgres volume is created. Dev passwords only; production
# roles are created by the DBA with strong passwords (see infra/ops/database.md).
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v owner_password=agentor_owner_dev \
  -v web_password=agentor_web_dev \
  -v worker_password=agentor_worker_dev \
  -v support_password=agentor_support_dev \
  -v ops_password=agentor_ops_dev \
  -v db_name=agentor \
  -f /agentor/roles.sql
