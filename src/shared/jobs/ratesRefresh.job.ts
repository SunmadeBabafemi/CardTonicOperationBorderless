import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BaseCronTask } from '@core/common/scheduler/baseCron.task';
import { FxService } from '@core/modules/fx/fx.service';

/** Calls the external FX provider every 6 hours (FX_REFRESH_CRON) and stores new rates. */
@Injectable()
export class RatesRefreshTask
  extends BaseCronTask
  implements OnModuleInit, OnModuleDestroy
{
  private readonly jobName = 'ratesRefresh';

  constructor(
    scheduler: SchedulerRegistry,
    config: ConfigService,
    private readonly fx: FxService,
  ) {
    super(scheduler, config);
  }

  onModuleInit() {
    this.registerCronJob({
      jobName: this.jobName,
      configKey: 'FX_REFRESH_CRON',
      defaultCronExpression: '0 */6 * * *',
      onTick: async () => {
        if (this.config.get<string>('FX_MODE') !== 'live') return;
        await this.fx.refreshNow();
        this.logger.log('Stored refreshed exchange rates');
      },
    });
  }

  onModuleDestroy() {
    this.unregisterCronJob(this.jobName);
  }
}
