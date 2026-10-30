import { ErrorResponse } from '@core/common/helpers/response';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisCacheService.name);

  constructor(private readonly config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: config.getOrThrow<number>('REDIS_TIMEOUT_MS'),
      commandTimeout: config.getOrThrow<number>('REDIS_TIMEOUT_MS'),
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    });
    this.client.on('error', () =>
      this.logger.warn('Redis rate cache connection unavailable'),
    );
  }

  async onModuleInit() {
    try {
      await this.client.connect();
    } catch {
      this.client.disconnect();
      this.unavailable();
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  private key(suffix: string) {
    return `${this.config.getOrThrow<string>('REDIS_KEY_PREFIX')}:${suffix}`;
  }

  async get(suffix: string): Promise<string | null> {
    try {
      return await this.client.get(this.key(suffix));
    } catch {
      this.unavailable();
    }
  }

  async set(suffix: string, value: string, ttlSeconds: number) {
    try {
      await this.client.set(this.key(suffix), value, 'EX', ttlSeconds);
    } catch {
      this.unavailable();
    }
  }

  async del(suffix: string) {
    try {
      await this.client.del(this.key(suffix));
    } catch {
      this.unavailable();
    }
  }

  async ping() {
    try {
      await this.client.ping();
    } catch {
      this.unavailable();
    }
  }

  private unavailable(): never {
    return ErrorResponse(
      'Rate cache is unavailable; please retry shortly',
      503,
    );
  }
}
