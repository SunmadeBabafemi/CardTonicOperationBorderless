import { Module } from '@nestjs/common';
import { FxModule } from '@core/modules/fx/fx.module';
import { RatesController } from './rates.controller';

@Module({ imports: [FxModule], controllers: [RatesController] })
export class RatesModule {}
