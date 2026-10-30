import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FxModule } from '@core/modules/fx/fx.module';
import { AuthGuard } from './guards';
import { RatesRefreshTask } from './jobs';
import { AuthenticationService } from './services/authentication.service';
import { LedgerService } from './services/ledger.service';
import { OwnershipService } from './services/ownership.service';

@Global()
@Module({
  imports: [FxModule],
  providers: [
    AuthenticationService,
    LedgerService,
    OwnershipService,
    RatesRefreshTask,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthenticationService, LedgerService, OwnershipService, FxModule],
})
export class SharedModule {}
