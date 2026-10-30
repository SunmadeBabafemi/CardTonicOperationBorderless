import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/shared.module';
import { VirtualBankAccountsModule } from '@api/virtualBankAccounts/virtualBankAccounts.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [SharedModule, VirtualBankAccountsModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}
