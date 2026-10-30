import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { HttpCodesEnum } from '@core/common/enums/httpCodes.enum';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  Currency,
  LedgerEntryType,
  TransactionChannel,
  TransactionType,
  WalletKind,
} from '@core/common/money/currency';
import {
  assertBalanceBounds,
  Money,
  parseAmount,
} from '@core/common/money/money';
import { databaseErrorCode } from '@core/common/errors/databaseErrorCode';
import { FxService, SelectedFx } from '@core/modules/fx/fx.service';
import { FxQuoteService } from '@core/modules/fx/fxQuote.service';
import { TransactionLog } from '@database/entities/transactionLog.entity';
import { findWallets, WalletRow } from '@database/queries/wallet.queries';

export interface Movement {
  type: TransactionType;
  /** Null for deposits. */
  fromWalletId: string | null;
  toWalletId: string;
  amount: string;
  quoteId?: string;
}

interface Plan {
  type: TransactionType;
  from: WalletRow | null;
  to: WalletRow;
  amount: string;
}

type Origin =
  | {
      channel: TransactionChannel.API;
      userId: string;
      key: string;
      requestHash: string;
    }
  | {
      channel: TransactionChannel.VIRTUAL_ACCOUNT;
      virtualBankAccountId: string;
      externalReference: string;
      externalMetadata: Record<string, unknown>;
    };

export interface InboundCredit {
  virtualBankAccountId: string;
  walletId: string;
  settlementId: string;
  amount: string;
  metadata: Record<string, unknown>;
}

interface ReplayRow {
  id: string;
  request_hash: string;
}
interface CreditRow {
  id: string;
  virtual_bank_account_id: string;
  destination_amount: string;
}
interface Leg {
  walletId: string;
  entryType: LedgerEntryType;
  amount: string;
}

const RETRYABLE = ['40P01', '40001', '55P03', '57014'];

/**
 * The only writer of wallet balances. Each operation writes one
 * transaction log, one wallet ledger entry per leg and the new balances in
 * a single database transaction. SYSTEM wallets are the counterparty for
 * deposits and conversions, so entries net to zero per currency.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly database: DataSource,
    private readonly fx: FxService,
    private readonly quotes: FxQuoteService,
  ) {}

  async execute(
    request: Movement,
    key: string | undefined,
    userId: string,
  ): Promise<{ data: TransactionLog; replayed: boolean }> {
    try {
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
        ErrorResponse(
          'Idempotency-Key must contain 8–128 letters, digits, underscores, or hyphens',
          400,
        );
      }
      const amount = parseAmount(request.amount);
      const quoteId = request.quoteId?.toLowerCase();
      const plan = await this.plan(request, amount, userId);
      const fromCurrency = plan.from?.currency ?? plan.to.currency;
      const toCurrency = plan.to.currency;
      const hash = createHash('sha256')
        .update(
          JSON.stringify([
            plan.type,
            plan.from?.id ?? null,
            plan.to.id,
            amount,
            quoteId ?? null,
          ]),
        )
        .digest('hex');
      const prior = await this.findReplay(this.database.manager, userId, key);
      if (prior) return await this.replay(this.database.manager, prior, hash);
      let selection: SelectedFx | undefined;
      let rate = '1.000000000000000000';
      let destinationAmount = amount;
      if (fromCurrency !== toCurrency || quoteId) {
        const quote = await this.quotes.resolve(userId, {
          type: plan.type,
          fromWalletId: plan.from!.id,
          toWalletId: plan.to.id,
          fromCurrency,
          toCurrency,
          amount,
          quoteId,
        });
        selection = quote.selection;
        rate = quote.rate;
        destinationAmount = quote.destinationAmount;
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.database.transaction(
            'READ COMMITTED',
            async (manager) => {
              await manager.query("SET LOCAL lock_timeout = '3s'");
              await manager.query("SET LOCAL statement_timeout = '8s'");
              const data = await this.post(
                manager,
                plan,
                {
                  channel: TransactionChannel.API,
                  userId,
                  key,
                  requestHash: hash,
                },
                rate,
                destinationAmount,
                selection,
              );
              return { data, replayed: false };
            },
          );
        } catch (error) {
          const code = databaseErrorCode(error);
          // A concurrent request with the same key committed first.
          if (code === '23505') {
            const concurrent = await this.findReplay(
              this.database.manager,
              userId,
              key,
            );
            if (concurrent)
              return await this.replay(this.database.manager, concurrent, hash);
          }
          if (RETRYABLE.includes(code ?? '')) {
            if (attempt < 2) continue;
            ErrorResponse(
              'Please retry this request with the same idempotency key',
              503,
            );
          }
          catchBlockResponse(error);
        }
      }
      ErrorResponse(
        'Unreachable transaction retry state',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  /** Resolves and validates the wallets a request names. */
  private async plan(
    request: Movement,
    amount: string,
    userId: string,
  ): Promise<Plan> {
    const ids = [request.toWalletId, request.fromWalletId].filter(
      (id): id is string => id !== null,
    );
    const wallets = await findWallets(this.database.manager, ids);
    const to = wallets.get(request.toWalletId);
    if (!to || to.kind !== WalletKind.USER)
      ErrorResponse('The destination wallet was not found', 404);
    if (request.type === TransactionType.DEPOSIT) {
      if (to.user_id !== userId) ErrorResponse('Wallet was not found', 404);
      return { type: request.type, from: null, to, amount };
    }
    const from = request.fromWalletId
      ? wallets.get(request.fromWalletId)
      : undefined;
    if (!from || from.user_id !== userId)
      ErrorResponse('The source wallet was not found', 404);
    if (from.id === to.id)
      ErrorResponse(
        'Choose two different wallets',
        HttpCodesEnum.HTTP_UNPROCESSABLE_ENTITY,
      );
    if (request.type === TransactionType.SWAP && to.user_id !== userId)
      ErrorResponse(
        'A swap moves money between your own wallets',
        HttpCodesEnum.HTTP_UNPROCESSABLE_ENTITY,
      );
    if (request.type === TransactionType.TRANSFER && to.user_id === userId)
      ErrorResponse(
        'Use a swap to move money between your own wallets',
        HttpCodesEnum.HTTP_UNPROCESSABLE_ENTITY,
      );
    return { type: request.type, from, to, amount };
  }

  /**
   * Posts an inbound bank transfer to a virtual bank account as a DEPOSIT.
   * The provider's settlement ID is stored as the external reference, so a
   * redelivered webhook resolves to the original transaction.
   */
  async creditVirtualAccount(
    credit: InboundCredit,
  ): Promise<{ data: TransactionLog; duplicate: boolean }> {
    try {
      const amount = parseAmount(credit.amount);
      const prior = await this.findCredit(credit.settlementId);
      if (prior) return await this.duplicateCredit(prior, credit, amount);
      const wallets = await findWallets(this.database.manager, [
        credit.walletId,
      ]);
      const to = wallets.get(credit.walletId);
      if (!to) ErrorResponse('Wallet was not found', 404);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.database.transaction(
            'READ COMMITTED',
            async (manager) => {
              await manager.query("SET LOCAL lock_timeout = '3s'");
              await manager.query("SET LOCAL statement_timeout = '8s'");
              const data = await this.post(
                manager,
                { type: TransactionType.DEPOSIT, from: null, to, amount },
                {
                  channel: TransactionChannel.VIRTUAL_ACCOUNT,
                  virtualBankAccountId: credit.virtualBankAccountId,
                  externalReference: credit.settlementId,
                  externalMetadata: credit.metadata,
                },
                '1.000000000000000000',
                amount,
              );
              return { data, duplicate: false };
            },
          );
        } catch (error) {
          const code = databaseErrorCode(error);
          // The same settlement was delivered concurrently and committed first.
          if (code === '23505') {
            const concurrent = await this.findCredit(credit.settlementId);
            if (concurrent)
              return await this.duplicateCredit(concurrent, credit, amount);
          }
          if (RETRYABLE.includes(code ?? '') && attempt < 2) continue;
          catchBlockResponse(error);
        }
      }
      ErrorResponse(
        'Unreachable transaction retry state',
        HttpCodesEnum.HTTP_SERVER_ERROR,
      );
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  private async findCredit(
    settlementId: string,
  ): Promise<CreditRow | undefined> {
    const rows = await this.database.query<CreditRow[]>(
      'SELECT id, virtual_bank_account_id, destination_amount FROM transaction_logs WHERE external_reference = $1',
      [settlementId],
    );
    return rows[0];
  }

  private async duplicateCredit(
    prior: CreditRow,
    credit: InboundCredit,
    amount: string,
  ) {
    if (
      prior.virtual_bank_account_id !== credit.virtualBankAccountId ||
      prior.destination_amount !== amount
    )
      ErrorResponse(
        'This settlement ID was already used for a different credit',
        409,
      );
    const data = await this.database
      .getRepository(TransactionLog)
      .findOneByOrFail({ id: prior.id });
    return { data, duplicate: true };
  }

  private async findReplay(
    manager: EntityManager,
    userId: string,
    key: string,
  ): Promise<ReplayRow | undefined> {
    const rows = await manager.query<ReplayRow[]>(
      'SELECT id, request_hash FROM transaction_logs WHERE initiated_by_user_id = $1 AND idempotency_key = $2',
      [userId, key],
    );
    return rows[0];
  }

  private async replay(manager: EntityManager, prior: ReplayRow, hash: string) {
    if (prior.request_hash !== hash)
      ErrorResponse('This idempotency key belongs to a different request', 409);
    const data = await manager
      .getRepository(TransactionLog)
      .findOneByOrFail({ id: prior.id });
    return { data, replayed: true };
  }

  private reference(): string {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `TXN-${date}-${randomBytes(6).toString('hex').toUpperCase()}`;
  }

  private describe(
    plan: Plan,
    destinationAmount: string,
    origin: Origin,
  ): string {
    const from = plan.from?.currency ?? plan.to.currency;
    const to = plan.to.currency;
    switch (plan.type) {
      case TransactionType.DEPOSIT:
        return origin.channel === TransactionChannel.VIRTUAL_ACCOUNT
          ? `Bank transfer of ${plan.amount} ${to} to virtual account`
          : `Deposit of ${plan.amount} ${to}`;
      case TransactionType.SWAP:
        return `Swap of ${plan.amount} ${from} to ${destinationAmount} ${to}`;
      case TransactionType.TRANSFER:
        return from === to
          ? `Transfer of ${plan.amount} ${from}`
          : `Transfer of ${plan.amount} ${from} received as ${destinationAmount} ${to}`;
    }
  }

  private async post(
    manager: EntityManager,
    plan: Plan,
    origin: Origin,
    rate: string,
    destinationAmount: string,
    selection?: SelectedFx,
  ): Promise<TransactionLog> {
    const fromCurrency = plan.from?.currency ?? plan.to.currency;
    const toCurrency = plan.to.currency;
    const crossCurrency = fromCurrency !== toCurrency;
    if (crossCurrency && !selection)
      ErrorResponse(
        'The conversion rate has expired. Please request a new rate.',
        409,
      );
    const systemCurrencies = new Set<Currency>();
    if (!plan.from) systemCurrencies.add(toCurrency);
    if (crossCurrency) {
      systemCurrencies.add(fromCurrency);
      systemCurrencies.add(toCurrency);
    }
    const systems = systemCurrencies.size
      ? await manager.query<WalletRow[]>(
          `SELECT id, user_id, currency, kind, balance FROM wallets
           WHERE kind = 'SYSTEM' AND currency = ANY($1::text[])`,
          [[...systemCurrencies]],
        )
      : [];
    const system = (currency: Currency) => {
      const wallet = systems.find((row) => row.currency === currency);
      if (!wallet)
        ErrorResponse('System wallet missing', HttpCodesEnum.HTTP_SERVER_ERROR);
      return wallet.id;
    };
    const legs: Leg[] = [];
    if (!plan.from) {
      legs.push({
        walletId: system(toCurrency),
        entryType: LedgerEntryType.DEBIT,
        amount: plan.amount,
      });
    } else {
      legs.push({
        walletId: plan.from.id,
        entryType: LedgerEntryType.DEBIT,
        amount: plan.amount,
      });
      if (crossCurrency) {
        legs.push({
          walletId: system(fromCurrency),
          entryType: LedgerEntryType.CREDIT,
          amount: plan.amount,
        });
        legs.push({
          walletId: system(toCurrency),
          entryType: LedgerEntryType.DEBIT,
          amount: destinationAmount,
        });
      }
    }
    legs.push({
      walletId: plan.to.id,
      entryType: LedgerEntryType.CREDIT,
      amount: destinationAmount,
    });

    // Lock every affected wallet in one deterministic order.
    const locked = new Map<string, WalletRow>();
    for (const id of [...new Set(legs.map((leg) => leg.walletId))].sort()) {
      const [row] = await manager.query<WalletRow[]>(
        'SELECT id, user_id, currency, kind, balance FROM wallets WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!row)
        ErrorResponse(
          'Resolved wallet disappeared',
          HttpCodesEnum.HTTP_SERVER_ERROR,
        );
      locked.set(id, row);
    }
    const signed = (leg: Leg) =>
      leg.entryType === LedgerEntryType.CREDIT
        ? new Money(leg.amount)
        : new Money(leg.amount).negated();
    const totals = new Map<Currency, InstanceType<typeof Money>>();
    for (const leg of legs) {
      const currency = locked.get(leg.walletId)!.currency;
      totals.set(
        currency,
        (totals.get(currency) ?? new Money(0)).plus(signed(leg)),
      );
    }
    if ([...totals.values()].some((value) => !value.eq(0)))
      ErrorResponse('Unbalanced posting', HttpCodesEnum.HTTP_SERVER_ERROR);
    if (
      selection?.quoteExpiresAt &&
      Date.parse(selection.quoteExpiresAt) <= Date.now()
    )
      ErrorResponse(
        'The conversion rate has expired. Please request a new rate.',
        409,
      );

    const logs = manager.getRepository(TransactionLog);
    const api = origin.channel === TransactionChannel.API;
    const log = await logs.save({
      id: randomUUID(),
      reference: this.reference(),
      type: plan.type,
      channel: origin.channel,
      description: this.describe(plan, destinationAmount, origin),
      initiatedByUserId: api ? origin.userId : null,
      idempotencyKey: api ? origin.key : null,
      requestHash: api ? origin.requestHash : null,
      sourceWalletId: plan.from?.id ?? null,
      destinationWalletId: plan.to.id,
      sourceCurrency: fromCurrency,
      destinationCurrency: toCurrency,
      sourceAmount: plan.amount,
      destinationAmount,
      rate,
      sourceRateId: crossCurrency
        ? (selection?.rates[fromCurrency]?.id ?? null)
        : null,
      destinationRateId: crossCurrency
        ? (selection?.rates[toCurrency]?.id ?? null)
        : null,
      fxMetadata: selection
        ? this.fx.metadata(selection, fromCurrency, toCurrency)
        : null,
      virtualBankAccountId: api ? null : origin.virtualBankAccountId,
      externalReference: api ? null : origin.externalReference,
      externalMetadata: api ? null : origin.externalMetadata,
    });
    for (const [index, leg] of legs.entries()) {
      const wallet = locked.get(leg.walletId)!;
      const before = wallet.balance;
      const after = new Money(before).plus(signed(leg));
      assertBalanceBounds(after);
      if (wallet.kind === WalletKind.USER && after.lt(0)) {
        ErrorResponse(
          'The source balance cannot cover this amount',
          HttpCodesEnum.HTTP_UNPROCESSABLE_ENTITY,
        );
      }
      await manager.query(
        `INSERT INTO wallet_ledgers(transaction_log_id, wallet_id, entry_type, amount, balance_before, balance_after, sequence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          log.id,
          wallet.id,
          leg.entryType,
          leg.amount,
          before,
          after.toFixed(6),
          index + 1,
        ],
      );
      await manager.query('UPDATE wallets SET balance = $1 WHERE id = $2', [
        after.toFixed(6),
        wallet.id,
      ]);
      wallet.balance = after.toFixed(6);
    }
    // Re-read so first responses and idempotent replays serialize identically.
    return logs.findOneByOrFail({ id: log.id });
  }
}
