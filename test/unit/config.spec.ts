import { randomBytes } from 'node:crypto';
import { validateEnv } from '@core/core.env';

const AUTH_JWT_SECRET = randomBytes(64).toString('base64url');

describe('configuration', () => {
  it('provides local defaults with an explicit signing key', () => {
    expect(validateEnv({ AUTH_JWT_SECRET }).PORT).toBe(3000);
    expect(validateEnv({ AUTH_JWT_SECRET }).FX_MODE).toBe('live');
    expect(validateEnv({ AUTH_JWT_SECRET }).AUTH_ACCESS_TTL_SECONDS).toBe(3600);
    expect(
      validateEnv({ AUTH_JWT_SECRET, AUTH_ACCESS_TTL_SECONDS: '1800' })
        .AUTH_ACCESS_TTL_SECONDS,
    ).toBe(1800);
  });

  it('rejects a missing signing key', () => {
    expect(() => validateEnv({})).toThrow('AUTH_JWT_SECRET');
  });

  it.each([
    { AUTH_ACCESS_TTL_SECONDS: '0' },
    { AUTH_REFRESH_TTL_SECONDS: '0' },
    { AUTH_REFRESH_TTL_SECONDS: '3600', AUTH_ACCESS_TTL_SECONDS: '3600' },
    { AUTH_JWT_SECRET: '' },
    { AUTH_JWT_SECRET: 'short' },
    { AUTH_JWT_SECRET: 'x'.repeat(128) },
    { AUTH_RATE_LIMIT_PER_MINUTE: '0' },
    { PORT: 'abc' },
    { PORT: '-1' },
    { DATABASE_URL: 'mysql://localhost/test' },
    { FX_MODE: 'silent' },
    { FX_TIMEOUT_MS: '0' },
    { REDIS_URL: 'https://localhost' },
    { REDIS_KEY_PREFIX: 'bad prefix' },
    { REDIS_TIMEOUT_MS: '0' },
    { FX_QUOTE_TTL_SECONDS: '0' },
    { DATABASE_POOL_MAX: '100' },
  ])('rejects invalid startup configuration %j', (input) => {
    expect(() => validateEnv({ AUTH_JWT_SECRET, ...input })).toThrow();
  });
});
