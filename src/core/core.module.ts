import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { validateEnv } from './core.env';
import { ResponseFilter } from './common/response/response.filter';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
  providers: [{ provide: APP_FILTER, useClass: ResponseFilter }],
  exports: [ConfigModule],
})
export class CoreModule {}
