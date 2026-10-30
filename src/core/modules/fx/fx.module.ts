import { Module } from '@nestjs/common';
import { FxProvider, FrankfurterProvider } from './fx.provider';
import { FxService } from './fx.service';
import { RedisCacheModule } from '../redis/redis.module';
import { FxQuoteService } from './fxQuote.service';

@Module({
  imports: [RedisCacheModule],
  providers: [
    FxService,
    FxQuoteService,
    { provide: FxProvider, useClass: FrankfurterProvider },
  ],
  exports: [FxService, FxQuoteService],
})
export class FxModule {}
