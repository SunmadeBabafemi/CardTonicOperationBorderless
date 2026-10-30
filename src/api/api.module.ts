import { AuthModule } from './auth/auth.module';
import { Module } from '@nestjs/common';
import { WalletsModule } from './wallets/wallets.module';
import { TransfersModule } from './transfers/transfers.module';
import { TransactionsModule } from './transactions/transactions.module';
import { RatesModule } from './rates/rates.module';
import { DevToolsModule } from './devTools/devTools.module';
import { VirtualBankAccountsModule } from './virtualBankAccounts/virtualBankAccounts.module';

export const API_MODULES = [
  AuthModule,
  WalletsModule,
  TransfersModule,
  TransactionsModule,
  RatesModule,
  VirtualBankAccountsModule,
  DevToolsModule,
];

@Module({ imports: API_MODULES })
export class ApiModule {}
