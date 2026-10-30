import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { DataSource, EntityManager, In } from 'typeorm';
import { VirtualBankAccountStatus } from '@core/common/money/currency';
import { QueueJobs, QueueNames } from '@core/common/enums/queue.enum';
import { databaseErrorCode } from '@core/common/errors/databaseErrorCode';
import { isValidWebhookSignature } from '@core/common/helpers/webhook/webhookSignature';
import { User } from '@database/entities/user.entity';
import { Wallet } from '@database/entities/wallet.entity';
import { VirtualBankAccount } from '@database/entities/virtualBankAccount.entity';
import { LedgerService } from '@shared/services/ledger.service';
import { BankProvider } from './bankProvider';
import { BankCreditWebhookDto } from './dto/virtualBankAccount.dto';

@Injectable()
export class VirtualBankAccountsService {
  private readonly logger = new Logger(VirtualBankAccountsService.name);

  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly ledger: LedgerService,
    private readonly bank: BankProvider,
    @InjectQueue(QueueNames.VIRTUAL_BANK_ACCOUNTS)
    private readonly queue: Queue,
  ) {}

  /** Records a PENDING account inside the caller's transaction (wallet creation). */
  async open(manager: EntityManager, walletId: string) {
    return manager.getRepository(VirtualBankAccount).save({
      walletId,
      provider: this.bank.name,
      status: VirtualBankAccountStatus.PENDING,
      accountNumber: null,
      accountName: null,
      bankName: null,
      failureReason: null,
    });
  }

  /**
   * Queues issuance. The job id is the account id, so a request that is
   * already queued is not duplicated. If Redis is unavailable the account
   * stays PENDING and can be requested again.
   */
  async enqueue(virtualBankAccountId: string): Promise<void> {
    try {
      await this.queue.add(
        QueueJobs.provisionVirtualBankAccount,
        { virtualBankAccountId },
        {
          jobId: virtualBankAccountId,
          attempts: this.config.getOrThrow<number>('VBA_PROVISION_ATTEMPTS'),
          backoff: {
            type: 'exponential',
            delay: this.config.getOrThrow<number>('VBA_PROVISION_BACKOFF_MS'),
          },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not queue virtual bank account ${virtualBankAccountId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /** Re-requests issuance for a wallet whose account is PENDING or FAILED. */
  async request(walletId: string) {
    try {
      const repository = this.database.getRepository(VirtualBankAccount);
      let account = await repository.findOneBy({ walletId });
      if (
        account &&
        ![
          VirtualBankAccountStatus.PENDING,
          VirtualBankAccountStatus.FAILED,
        ].includes(account.status)
      )
        ErrorResponse('This wallet already has a virtual bank account', 409);
      if (!account) {
        account = await this.open(this.database.manager, walletId);
      } else if (account.status === VirtualBankAccountStatus.FAILED) {
        await repository.update(
          { id: account.id, status: VirtualBankAccountStatus.FAILED },
          { status: VirtualBankAccountStatus.PENDING, failureReason: null },
        );
      }
      await this.enqueue(account.id);
      return repository.findOneByOrFail({ id: account.id });
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  /** Job handler: asks the bank for account details and activates the account. */
  async provision(virtualBankAccountId: string): Promise<void> {
    const repository = this.database.getRepository(VirtualBankAccount);
    const account = await repository.findOneBy({ id: virtualBankAccountId });
    if (!account || account.status !== VirtualBankAccountStatus.PENDING) return;
    const wallet = await this.database
      .getRepository(Wallet)
      .findOneByOrFail({ id: account.walletId });
    const user = await this.database
      .getRepository(User)
      .findOneByOrFail({ id: wallet.userId! });
    const issued = await this.bank.issueAccount({
      walletId: wallet.id,
      currency: wallet.currency,
      // Banks issue collection accounts in the customer's registered name.
      accountName: `BorderFlow / ${user.firstName} ${user.lastName}`,
    });
    try {
      await repository.update(
        { id: account.id, status: VirtualBankAccountStatus.PENDING },
        {
          ...issued,
          status: VirtualBankAccountStatus.ACTIVE,
          failureReason: null,
        },
      );
    } catch (error) {
      // An account-number collision fails this attempt; BullMQ retries.
      if (databaseErrorCode(error) === '23505')
        throw new Error('Issued account number is already in use');
      throw error;
    }
  }

  async markFailed(virtualBankAccountId: string, reason: string) {
    await this.database.getRepository(VirtualBankAccount).update(
      {
        id: virtualBankAccountId,
        status: In([VirtualBankAccountStatus.PENDING]),
      },
      {
        status: VirtualBankAccountStatus.FAILED,
        failureReason: reason.slice(0, 500),
      },
    );
  }

  async credit(
    signature: string | undefined,
    rawBody: Buffer | undefined,
    input: BankCreditWebhookDto,
  ) {
    try {
      this.verifySignature(signature, rawBody);
      const account = await this.database
        .getRepository(VirtualBankAccount)
        .findOneBy({
          provider: this.bank.name,
          accountNumber: input.accountNumber,
        });
      if (!account) ErrorResponse('Virtual bank account was not found', 404);
      if (account.status !== VirtualBankAccountStatus.ACTIVE)
        ErrorResponse('Virtual bank account is not active', 422);
      const result = await this.ledger.creditVirtualAccount({
        virtualBankAccountId: account.id,
        walletId: account.walletId,
        settlementId: input.settlementId,
        amount: input.amount,
        metadata: {
          provider: account.provider,
          sessionId: input.sessionId ?? null,
          sourceAccountName: input.sourceAccountName ?? null,
          sourceAccountNumber: input.sourceAccountNumber ?? null,
          sourceBankName: input.sourceBankName ?? null,
          narration: input.narration ?? null,
        },
      });
      return { duplicate: result.duplicate, transaction: result.data };
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  /** Expects `X-Webhook-Signature: <hex HMAC-SHA512 of the raw body>`. */
  private verifySignature(signature: string | undefined, rawBody?: Buffer) {
    const secret = this.config.getOrThrow<string>('VBA_WEBHOOK_SECRET');
    if (!secret)
      ErrorResponse('Virtual bank account webhooks are not configured', 503);
    if (
      !rawBody ||
      !signature ||
      !isValidWebhookSignature(secret, rawBody, signature)
    )
      ErrorResponse('Invalid webhook signature', 401);
  }
}
