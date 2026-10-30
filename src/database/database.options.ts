import { join } from 'node:path';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { User } from './entities/user.entity';
import { UserSession } from './entities/userSession.entity';
import { RefreshToken } from './entities/refreshToken.entity';
import { Wallet } from './entities/wallet.entity';
import { WalletLedger } from './entities/walletLedger.entity';
import { TransactionLog } from './entities/transactionLog.entity';
import { Rate } from './entities/rate.entity';
import { VirtualBankAccount } from './entities/virtualBankAccount.entity';

export function databaseOptions(
  url: string,
  poolMax = 10,
): PostgresConnectionOptions {
  return {
    type: 'postgres',
    uuidExtension: 'pgcrypto',
    installExtensions: false,
    url,
    entities: [
      User,
      UserSession,
      RefreshToken,
      Wallet,
      WalletLedger,
      TransactionLog,
      Rate,
      VirtualBankAccount,
    ],
    migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
    migrationsRun: true,
    synchronize: false,
    logging: false,
    extra: {
      max: poolMax,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    },
  };
}
