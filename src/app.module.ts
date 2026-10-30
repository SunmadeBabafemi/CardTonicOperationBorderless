import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { CoreModule } from '@core/core.module';
import { DatabaseModule } from '@database/database.module';
import { HealthModule } from '@core/modules/health/health.module';
import { SharedModule } from '@shared/shared.module';
import { QueueModule } from '@core/modules/queue/queue.module';
import { ApiModule, API_MODULES } from '@api/api.module';

@Module({
  imports: [
    CoreModule,
    ScheduleModule.forRoot(),
    QueueModule,
    DatabaseModule,
    SharedModule,
    HealthModule,
    ApiModule,
    RouterModule.register([
      { path: 'v1', module: ApiModule, children: API_MODULES },
    ]),
  ],
})
export class AppModule {}
