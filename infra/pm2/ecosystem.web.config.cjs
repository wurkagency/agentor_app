// PM2 processes for OS user agentor-web (produktspecifikation §10.1).
// Start as that user:  sudo -u agentor-web pm2 start infra/pm2/ecosystem.web.config.cjs --env production
// Releases live in versioned folders; "current" is a symlink, so rollback is one symlink switch (§10.5).
const root = '/var/www/vhosts/agentor.dk/app/current';
const envFile = '/var/www/vhosts/agentor.dk/app/shared/web.env.production'; // mode 0400, agentor-web

module.exports = {
  apps: [
    {
      name: 'agentor-app',
      cwd: `${root}/apps/web/.next/standalone/apps/web`,
      script: 'server.js',
      node_args: `--env-file=${envFile}`,
      env_production: { NODE_ENV: 'production', PORT: '3000', HOSTNAME: '127.0.0.1' },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '768M',
      kill_timeout: 10000,
      time: true,
    },
    {
      name: 'agentor-ingest',
      cwd: `${root}/apps/ingest`,
      script: 'dist/main.js',
      node_args: `--env-file=${envFile}`,
      env_production: { NODE_ENV: 'production', INGEST_HOST: '127.0.0.1', INGEST_PORT: '3100' },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      kill_timeout: 10000,
      time: true,
    },
  ],
};
