import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database.options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...databaseOptions(
          config.getOrThrow<string>('DATABASE_URL'),
          config.getOrThrow<number>('DATABASE_POOL_MAX'),
        ),
        retryAttempts: 1,
      }),
    }),
  ],
})
export class DatabaseModule {}
