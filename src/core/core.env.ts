import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { HttpCodesEnum } from '@core/common/enums/httpCodes.enum';
export function validateEnv(input: Record<string, unknown>) {
  try {
    const text = (key: string, fallback: string): string => {
      const value = input[key] ?? fallback;
      if (typeof value !== 'string' || !value.trim()) {
        ErrorResponse(
          `${key} must be a nonempty string`,
          HttpCodesEnum.HTTP_SERVER_ERROR,
        );
      }
      return value;
    };
    const integer = (
      key: string,
      fallback: string,
      min: number,
      max: number,
    ) => {
      const value = Number(text(key, fallback));
      if (!Number.isSafeInteger(value) || value < min || value > max) {
        ErrorResponse(
          `${key} must be an integer from ${min} to ${max}`,
          HttpCodesEnum.HTTP_SERVER_ERROR,
        );
      }
      return value;
    };
    const databaseUrl = text(
      'DATABASE_URL',
      'postgresql://borderflow:borderflow@127.0.0.1:5434/borderflow',
    );
    if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
      ErrorResponse(
        'DATABASE_URL must be a PostgreSQL URL',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    }
    const fxBaseUrl = text('FX_BASE_URL', 'https://api.frankfurter.dev');
    if (!['https:', 'http:'].includes(new URL(fxBaseUrl).protocol)) {
      ErrorResponse(
        'FX_BASE_URL must be an HTTP(S) URL',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    }
    const fxMode = text('FX_MODE', 'live');
    if (!['fixed', 'live'].includes(fxMode)) {
      ErrorResponse(
        'FX_MODE must be fixed or live',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    }
    const nodeEnv = text('NODE_ENV', 'development');
    if (!['development', 'test', 'production'].includes(nodeEnv)) {
      ErrorResponse(
        'NODE_ENV must be development, test, or production',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    }
    const jwtSecret = text('AUTH_JWT_SECRET', '');
    if (
      Buffer.byteLength(jwtSecret, 'utf8') < 64 ||
      new Set(jwtSecret).size < 16
    ) {
      ErrorResponse(
        'AUTH_JWT_SECRET must contain at least 64 bytes of randomly generated key material',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    }
    const accessTtl = integer('AUTH_ACCESS_TTL_SECONDS', '3600', 60, 3600);
    const redisUrl = text('REDIS_URL', 'redis://127.0.0.1:6379');
    if (!['redis:', 'rediss:'].includes(new URL(redisUrl).protocol))
      ErrorResponse(
        'REDIS_URL must be a Redis URL',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    const redisPrefix = text('REDIS_KEY_PREFIX', 'borderflow');
    if (!/^[A-Za-z0-9:_-]{1,100}$/.test(redisPrefix))
      ErrorResponse(
        'REDIS_KEY_PREFIX must be 1–100 letters, digits, colons, underscores or hyphens',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    // Optional: without a secret the virtual account webhook answers 503.
    const vbaWebhookSecret = input.VBA_WEBHOOK_SECRET ?? '';
    if (
      typeof vbaWebhookSecret !== 'string' ||
      (vbaWebhookSecret !== '' &&
        Buffer.byteLength(vbaWebhookSecret, 'utf8') < 32)
    ) {
      ErrorResponse(
        'VBA_WEBHOOK_SECRET must be empty or contain at least 32 bytes',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    }
    // Five-field cron; the rates job calls the provider on this schedule.
    const fxRefreshCron = text('FX_REFRESH_CRON', '0 */6 * * *');
    if (!/^(\S+\s+){4}\S+$/.test(fxRefreshCron.trim()))
      ErrorResponse(
        'FX_REFRESH_CRON must be a five-field cron expression',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    const refreshTtl = integer(
      'AUTH_REFRESH_TTL_SECONDS',
      '2592000',
      3600,
      7776000,
    );
    if (refreshTtl <= accessTtl)
      ErrorResponse(
        'AUTH_REFRESH_TTL_SECONDS must exceed AUTH_ACCESS_TTL_SECONDS',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    return {
      ...input,
      NODE_ENV: nodeEnv,
      PORT: integer('PORT', '3000', 1, 65535),
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_MAX: integer('DATABASE_POOL_MAX', '10', 1, 40),
      FX_MODE: fxMode,
      FX_BASE_URL: fxBaseUrl,
      FX_TIMEOUT_MS: integer('FX_TIMEOUT_MS', '2000', 100, 10000),
      FX_REFRESH_SECONDS: integer('FX_REFRESH_SECONDS', '21600', 1, 86400),
      FX_REFRESH_CRON: fxRefreshCron,
      FX_MAX_AGE_DAYS: integer('FX_MAX_AGE_DAYS', '7', 1, 30),
      FX_QUOTE_TTL_SECONDS: integer('FX_QUOTE_TTL_SECONDS', '300', 30, 900),
      REDIS_URL: redisUrl,
      REDIS_KEY_PREFIX: redisPrefix,
      REDIS_TIMEOUT_MS: integer('REDIS_TIMEOUT_MS', '1000', 100, 5000),
      AUTH_JWT_SECRET: jwtSecret,
      AUTH_JWT_ISSUER: text('AUTH_JWT_ISSUER', 'borderflow'),
      AUTH_JWT_AUDIENCE: text('AUTH_JWT_AUDIENCE', 'borderflow-api'),
      AUTH_ACCESS_TTL_SECONDS: accessTtl,
      AUTH_REFRESH_TTL_SECONDS: refreshTtl,
      AUTH_RATE_LIMIT_PER_MINUTE: integer(
        'AUTH_RATE_LIMIT_PER_MINUTE',
        '10',
        1,
        1000,
      ),
      RATE_LIMIT_PER_MINUTE: integer('RATE_LIMIT_PER_MINUTE', '120', 1, 100000),
      VBA_WEBHOOK_SECRET: vbaWebhookSecret,
      VBA_PROVISION_ATTEMPTS: integer('VBA_PROVISION_ATTEMPTS', '5', 1, 20),
      VBA_PROVISION_BACKOFF_MS: integer(
        'VBA_PROVISION_BACKOFF_MS',
        '2000',
        10,
        600000,
      ),
    };
  } catch (error) {
    catchBlockResponse(error);
  }
}
