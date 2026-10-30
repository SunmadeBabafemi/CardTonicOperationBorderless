import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/** BullMQ connection options from REDIS_URL (BullMQ owns and closes its connections). */
export function queueConnection(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number(url.pathname.slice(1) || 0),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

/** Background jobs on the same Redis as the rate cache, under `<REDIS_KEY_PREFIX>:queue`. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: queueConnection(config.getOrThrow<string>('REDIS_URL')),
        prefix: `${config.getOrThrow<string>('REDIS_KEY_PREFIX')}:queue`,
      }),
    }),
  ],
})
export class QueueModule {}
