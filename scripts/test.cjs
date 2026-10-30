const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

function validateTestDatabase(value) {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !/^borderflow_test[a-zA-Z0-9_]*$/.test(url.pathname.slice(1)) ||
    url.search
  ) {
    throw new Error(
      'Tests require a local PostgreSQL URL with a database name starting borderflow_test and no query parameters.',
    );
  }
  return value;
}

function validateTestRedis(value) {
  const url = new URL(value);
  if (
    !['redis:', 'rediss:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/15' ||
    url.search
  ) {
    throw new Error(
      'Tests require an explicit local Redis URL using database 15 and no query parameters.',
    );
  }
  return value;
}

function run() {
  const project = `borderflow-test-${process.pid}`;
  const compose = ['compose', '-p', project, '-f', 'compose.test.yml'];
  let ownsServices = false;
  try {
    let databaseUrl = process.env.TEST_DATABASE_URL;
    let redisUrl = process.env.TEST_REDIS_URL;
    if (databaseUrl) validateTestDatabase(databaseUrl);
    if (redisUrl) validateTestRedis(redisUrl);
    const needed = [];
    if (!databaseUrl) needed.push('postgres-test');
    if (!redisUrl) needed.push('redis-test');
    if (needed.length) {
      ownsServices = true;
      const started = spawnSync(
        'docker',
        [...compose, 'up', '-d', '--wait', '--wait-timeout', '60', ...needed],
        { stdio: 'inherit' },
      );
      if (started.status !== 0)
        throw new Error(
          'Start Docker, or set TEST_DATABASE_URL and TEST_REDIS_URL to isolated local test services.',
        );
      const portFor = (service, internalPort) => {
        const port = spawnSync(
          'docker',
          [...compose, 'port', service, internalPort],
          { encoding: 'utf8' },
        );
        const published = port.stdout?.trim().split(':').pop();
        if (port.status !== 0 || !/^\d+$/.test(published ?? ''))
          throw new Error(`Could not determine the isolated ${service} port.`);
        return published;
      };
      if (!databaseUrl)
        databaseUrl = `postgresql://borderflow:borderflow@127.0.0.1:${portFor('postgres-test', '5432')}/borderflow_test`;
      if (!redisUrl)
        redisUrl = `redis://127.0.0.1:${portFor('redis-test', '6379')}/15`;
    }
    validateTestDatabase(databaseUrl);
    validateTestRedis(redisUrl);
    const prefix = `borderflow_test_${process.pid}_${randomBytes(8).toString('hex')}`;
    const jest = path.join(
      path.dirname(require.resolve('jest/package.json')),
      'bin/jest.js',
    );
    const result = spawnSync(
      process.execPath,
      [jest, '--runInBand', ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          TEST_DATABASE_URL: databaseUrl,
          REDIS_URL: redisUrl,
          TEST_REDIS_URL: redisUrl,
          REDIS_KEY_PREFIX: prefix,
          TEST_REDIS_PREFIX: prefix,
          NODE_ENV: 'test',
          AUTH_JWT_SECRET: randomBytes(64).toString('base64url'),
          VBA_WEBHOOK_SECRET: randomBytes(32).toString('hex'),
          AUTH_ACCESS_TTL_SECONDS: '3600',
          FX_MODE: 'fixed',
          RATE_LIMIT_PER_MINUTE: '100000',
        },
      },
    );
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (ownsServices)
      spawnSync('docker', [...compose, 'down', '-v', '--remove-orphans'], {
        stdio: 'inherit',
      });
  }
}

module.exports = { validateTestDatabase, validateTestRedis };
if (require.main === module) run();
