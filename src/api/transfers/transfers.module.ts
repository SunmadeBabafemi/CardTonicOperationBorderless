import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/shared.module';
import { TransfersController } from './transfers.controller';

@Module({ imports: [SharedModule], controllers: [TransfersController] })
export class TransfersModule {}
