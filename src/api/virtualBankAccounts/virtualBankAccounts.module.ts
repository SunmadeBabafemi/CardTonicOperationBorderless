import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueNames } from '@core/common/enums/queue.enum';
import { BankProvider, SandboxBankProvider } from './bankProvider';
import { VirtualBankAccountConsumer } from './virtualBankAccount.consumer';
import { VirtualBankAccountsController } from './virtualBankAccounts.controller';
import { VirtualBankAccountsService } from './virtualBankAccounts.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QueueNames.VIRTUAL_BANK_ACCOUNTS }),
  ],
  controllers: [VirtualBankAccountsController],
  providers: [
    VirtualBankAccountsService,
    VirtualBankAccountConsumer,
    { provide: BankProvider, useClass: SandboxBankProvider },
  ],
  exports: [VirtualBankAccountsService],
})
export class VirtualBankAccountsModule {}
