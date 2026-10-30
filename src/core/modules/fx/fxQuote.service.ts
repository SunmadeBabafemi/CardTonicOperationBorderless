import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { HttpCodesEnum } from '@core/common/enums/httpCodes.enum';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { Currency, WalletKind } from '@core/common/money/currency';
import { convertAmount, parseAmount } from '@core/common/money/money';
import { findWallets } from '@database/queries/wallet.queries';
import { RedisCacheService } from '../redis/redis.service';
import { FxService } from './fx.service';
import type { SelectedFx } from './fx.types';
import { QuoteInput, QuoteMovement, QuoteType } from './fxQuote.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CachedQuote {
  version: 2;
  userId: string;
  quoteId: string;
  type: QuoteType;
  fromWalletId: string;
  toWalletId: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  sourceAmount: string;
  destinationAmount: string;
  rate: string;
  expiresAt: string;
  sourceRateId: string;
  destinationRateId: string;
  source: SelectedFx['source'];
  stale: boolean;
}

@Injectable()
export class FxQuoteService {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly fx: FxService,
    private readonly cache: RedisCacheService,
  ) {}

  /** Prices a swap (both wallets yours) or transfer and locks it in Redis. */
  async create(userId: string, input: QuoteInput) {
    try {
      const fromWalletId = input.fromWalletId.toLowerCase();
      const toWalletId = input.toWalletId.toLowerCase();
      const wallets = await findWallets(this.database.manager, [
        fromWalletId,
        toWalletId,
      ]);
      const from = wallets.get(fromWalletId);
      const to = wallets.get(toWalletId);
      if (!from || from.user_id !== userId)
        ErrorResponse('The source wallet was not found', 404);
      if (!to || to.kind !== WalletKind.USER)
        ErrorResponse('The destination wallet was not found', 404);
      if (fromWalletId === toWalletId)
        ErrorResponse(
          'Choose two different wallets',
          HttpCodesEnum.HTTP_UNPROCESSABLE_ENTITY,
        );
      const type = to.user_id === userId ? QuoteType.SWAP : QuoteType.TRANSFER;
      const sourceAmount = parseAmount(input.amount);
      const selection = await this.fx.select();
      const rate = this.fx.rate(selection, from.currency, to.currency);
      const destinationAmount = convertAmount(sourceAmount, rate);
      const ttl = this.config.getOrThrow<number>('FX_QUOTE_TTL_SECONDS');
      const quote: CachedQuote = {
        version: 2,
        userId,
        quoteId: randomUUID(),
        type,
        fromWalletId,
        toWalletId,
        fromCurrency: from.currency,
        toCurrency: to.currency,
        sourceAmount,
        destinationAmount,
        rate,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        sourceRateId: selection.rates[from.currency]!.id,
        destinationRateId: selection.rates[to.currency]!.id,
        source: selection.source,
        stale: selection.stale,
      };
      await this.cache.set(
        `fx:quote:${quote.quoteId}`,
        JSON.stringify(quote),
        ttl,
      );
      const { version, userId: owner, ...response } = quote;
      void version;
      void owner;
      return {
        ...this.fx.metadata(selection, from.currency, to.currency),
        ...response,
      };
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  async resolve(userId: string, input: QuoteMovement) {
    try {
      if (!input.quoteId)
        ErrorResponse(
          'Get a rate quote before converting or sending across currencies',
          400,
        );
      const encoded = await this.cache.get(
        `fx:quote:${input.quoteId.toLowerCase()}`,
      );
      if (!encoded) this.expired();
      let quote: CachedQuote;
      try {
        quote = JSON.parse(encoded) as CachedQuote;
        if (
          !quote ||
          typeof quote !== 'object' ||
          quote.version !== 2 ||
          typeof quote.sourceRateId !== 'string' ||
          !UUID.test(quote.sourceRateId) ||
          typeof quote.destinationRateId !== 'string' ||
          !UUID.test(quote.destinationRateId) ||
          !['LIVE', 'STALE_CACHE', 'FIXED', 'FIXED_FALLBACK'].includes(
            quote.source,
          ) ||
          typeof quote.stale !== 'boolean' ||
          typeof quote.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(quote.expiresAt))
        )
          ErrorResponse('Invalid cached quote', HttpCodesEnum.HTTP_CONFLICT);
      } catch {
        ErrorResponse('The cached quote is invalid; request a new quote', 409);
      }
      if (Date.parse(quote.expiresAt) <= Date.now()) this.expired();
      if (
        quote.quoteId !== input.quoteId.toLowerCase() ||
        quote.userId !== userId ||
        quote.type !== String(input.type) ||
        quote.fromWalletId !== input.fromWalletId ||
        quote.toWalletId !== input.toWalletId ||
        quote.fromCurrency !== input.fromCurrency ||
        quote.toCurrency !== input.toCurrency ||
        quote.sourceAmount !== input.amount
      )
        ErrorResponse(
          'The quote does not match this user, operation, wallets, or amount',
          409,
        );
      const rows = await this.fx.findRates([
        quote.sourceRateId,
        quote.destinationRateId,
      ]);
      const sourceRate = rows.get(quote.sourceRateId);
      const destinationRate = rows.get(quote.destinationRateId);
      if (
        !sourceRate ||
        !destinationRate ||
        sourceRate.currency !== quote.fromCurrency ||
        destinationRate.currency !== quote.toCurrency
      )
        ErrorResponse(
          'The quoted rates are unavailable; request a new quote',
          409,
        );
      const selection: SelectedFx = {
        rates: {
          [quote.fromCurrency]: sourceRate,
          [quote.toCurrency]: destinationRate,
        },
        source: quote.source,
        stale: quote.stale,
        quoteId: quote.quoteId,
        quoteExpiresAt: quote.expiresAt,
      };
      // Re-derive from the exact stored rate rows shown to the customer.
      // Never fetch a newer rate during execution.
      if (
        quote.rate !==
          this.fx.rate(selection, input.fromCurrency, input.toCurrency) ||
        quote.destinationAmount !== convertAmount(input.amount, quote.rate)
      )
        ErrorResponse(
          'The quote data is inconsistent; request a new quote',
          409,
        );
      return {
        selection,
        rate: quote.rate,
        destinationAmount: quote.destinationAmount,
      };
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  private expired(): never {
    return ErrorResponse(
      'The conversion rate has expired. Please request a new rate.',
      409,
    );
  }
}
