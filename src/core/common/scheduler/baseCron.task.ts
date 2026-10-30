import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

export interface CronRegistration {
  jobName: string;
  /** Config key holding the cron expression; the default applies when unset. */
  configKey: string;
  defaultCronExpression: string;
  onTick: () => Promise<void>;
}

/** Registers a named cron job that never overlaps itself and logs failures. */
export abstract class BaseCronTask {
  protected readonly logger = new Logger(this.constructor.name);
  private running = false;

  protected constructor(
    protected readonly scheduler: SchedulerRegistry,
    protected readonly config: ConfigService,
  ) {}

  protected registerCronJob(options: CronRegistration): void {
    const expression =
      this.config.get<string>(options.configKey) ??
      options.defaultCronExpression;
    const job = new CronJob(expression, () => void this.tick(options));
    this.scheduler.addCronJob(options.jobName, job);
    job.start();
  }

  protected unregisterCronJob(jobName: string): void {
    if (this.scheduler.doesExist('cron', jobName))
      this.scheduler.deleteCronJob(jobName);
  }

  private async tick(options: CronRegistration): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await options.onTick();
    } catch (error) {
      this.logger.error(
        `${options.jobName} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
