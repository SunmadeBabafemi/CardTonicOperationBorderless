import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RedisCacheModule } from '../redis/redis.module';

@Module({ imports: [RedisCacheModule], controllers: [HealthController] })
export class HealthModule {}
