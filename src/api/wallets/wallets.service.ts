import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Currency, CURRENCIES, WalletKind } from '@core/common/money/currency';
import { Money } from '@core/common/money/money';
import { databaseErrorCode } from '@core/common/errors/databaseErrorCode';
import { FxService } from '@core/modules/fx/fx.service';
import { Wallet } from '@database/entities/wallet.entity';
import { VirtualBankAccountsService } from '@api/virtualBankAccounts/virtualBankAccounts.service';

@Injectable()
export class WalletsService {
  constructor(
    private readonly database: DataSource,
    private readonly fx: FxService,
    private readonly virtualBankAccounts: VirtualBankAccountsService,
  ) {}

  /**
   * Opens one wallet and its PENDING virtual bank account in one
   * transaction, then queues the account for background issuance.
   */
  async create(userId: string, currency: Currency) {
    try {
      const { walletId, accountId } = await this.database.transaction(
        async (manager) => {
          const wallet = await manager.getRepository(Wallet).save({
            userId,
            currency,
            kind: WalletKind.USER,
            balance: '0.000000',
          });
          const account = await this.virtualBankAccounts.open(
            manager,
            wallet.id,
          );
          return { walletId: wallet.id, accountId: account.id };
        },
      );
      await this.virtualBankAccounts.enqueue(accountId);
      return await this.find(walletId);
    } catch (error) {
      if (databaseErrorCode(error) === '23505')
        ErrorResponse(`You already have a ${currency} wallet`, 409);
      catchBlockResponse(error);
    }
  }

  /** The user's wallets with balances, funding accounts and total in USD. */
  async list(userId: string) {
    try {
      const rows = await this.database.getRepository(Wallet).find({
        where: { userId },
        relations: { virtualBankAccount: true },
      });
      const wallets = CURRENCIES.map((currency) =>
        rows.find((row) => row.currency === currency),
      ).filter((row): row is Wallet => row !== undefined);
      const selection = await this.fx.select();
      const totalUsd = wallets.reduce(
        (total, wallet) =>
          total.plus(
            new Money(wallet.balance).div(
              selection.rates[wallet.currency]!.unitsPerUsd,
            ),
          ),
        new Money(0),
      );
      return {
        wallets: wallets.map((wallet) => ({
          ...wallet,
          virtualBankAccount: wallet.virtualBankAccount ?? null,
        })),
        totalUsd: totalUsd.toFixed(6, Money.ROUND_HALF_EVEN),
        valuation: this.fx.metadata(selection),
      };
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  async find(id: string) {
    try {
      const wallet = await this.database.getRepository(Wallet).findOne({
        where: { id },
        relations: { virtualBankAccount: true },
      });
      if (!wallet) ErrorResponse('Wallet was not found', 404);
      return {
        ...wallet,
        virtualBankAccount: wallet.virtualBankAccount ?? null,
      };
    } catch (error) {
      catchBlockResponse(error);
    }
  }
}
