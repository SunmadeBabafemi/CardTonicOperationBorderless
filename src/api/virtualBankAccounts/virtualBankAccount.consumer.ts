import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QueueJobs, QueueNames } from '@core/common/enums/queue.enum';
import { VirtualBankAccountsService } from './virtualBankAccounts.service';

interface ProvisionJobData {
  virtualBankAccountId: string;
}

/** Issues virtual bank accounts in the background; BullMQ retries failures with backoff. */
@Processor(QueueNames.VIRTUAL_BANK_ACCOUNTS)
export class VirtualBankAccountConsumer extends WorkerHost {
  private readonly logger = new Logger(VirtualBankAccountConsumer.name);

  constructor(private readonly accounts: VirtualBankAccountsService) {
    super();
  }

  async process(job: Job<ProvisionJobData>): Promise<void> {
    switch (job.name) {
      case QueueJobs.provisionVirtualBankAccount:
        await this.accounts.provision(job.data.virtualBankAccountId);
        break;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProvisionJobData> | undefined, error: Error) {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    this.logger.warn(
      `${job.name} attempt ${job.attemptsMade}/${attempts} failed: ${error.message}`,
    );
    if (job.attemptsMade >= attempts)
      await this.accounts.markFailed(
        job.data.virtualBankAccountId,
        error.message,
      );
  }
}
