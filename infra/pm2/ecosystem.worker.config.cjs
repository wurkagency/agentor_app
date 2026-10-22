// PM2 processes for OS user agentor-worker (produktspecifikation §10.1). Only this user can
// read the KEK file. Start as that user:
//   sudo -u agentor-worker pm2 start infra/pm2/ecosystem.worker.config.cjs --env production
const root = '/var/www/vhosts/agentor.dk/app/current';
const envFile = '/var/www/vhosts/agentor.dk/app/shared/worker.env.production'; // mode 0400, agentor-worker

module.exports = {
  apps: [
    {
      name: 'agentor-worker',
      cwd: `${root}/apps/worker`,
      script: 'dist/main.js',
      node_args: `--env-file=${envFile}`,
      env_production: { NODE_ENV: 'production' },
      // Scales horizontally without code changes (§12); start with one.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      // Graceful deploy: workers finish active jobs within 60 s (§10.4).
      kill_timeout: 65000,
      time: true,
    },
    {
      name: 'agentor-scheduler',
      cwd: `${root}/apps/scheduler`,
      script: 'dist/main.js',
      node_args: `--env-file=${envFile}`,
      env_production: { NODE_ENV: 'production' },
      // Exactly one leader is enforced with a Redis lock; one instance is still the norm.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      kill_timeout: 10000,
      time: true,
    },
  ],
};
