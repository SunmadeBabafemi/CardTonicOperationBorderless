import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { HttpCodesEnum } from '@core/common/enums/httpCodes.enum';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parse } from 'lossless-json';
import { FIAT_CURRENCIES } from '@core/common/money/currency';
import { Money } from '@core/common/money/money';
import type { FxQuotes } from './fx.types';

export abstract class FxProvider {
  abstract fetchQuotes(): Promise<FxQuotes>;
}

@Injectable()
export class FrankfurterProvider extends FxProvider {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async fetchQuotes(): Promise<FxQuotes> {
    try {
      const url = new URL(
        '/v2/rates',
        this.config.getOrThrow<string>('FX_BASE_URL'),
      );
      url.searchParams.set('base', 'USD');
      url.searchParams.set('quotes', 'NGN,GHS,XAF,EUR');
      const response = await fetch(url, {
        signal: AbortSignal.timeout(
          this.config.getOrThrow<number>('FX_TIMEOUT_MS'),
        ),
        redirect: 'error',
      });
      if (!response.ok)
        ErrorResponse(
          'FX provider returned an unsuccessful response',
          HttpCodesEnum.HTTP_BAD_GATEWAY,
        );
      // Parse numeric JSON tokens directly into strings, before any Number conversion.
      const data = parse(await response.text(), null, (value) => value);
      return parseProviderQuotes(data);
    } catch (error) {
      catchBlockResponse(error);
    }
  }
}

export function parseProviderQuotes(data: unknown): FxQuotes {
  try {
    if (!Array.isArray(data) || data.length !== 4)
      ErrorResponse('Incomplete FX response', HttpCodesEnum.HTTP_BAD_GATEWAY);
    const quotes: Partial<FxQuotes> = {
      USD: { rate: '1', observedDate: null },
    };
    for (const value of data as unknown[]) {
      if (!value || typeof value !== 'object')
        ErrorResponse('Invalid FX quote', HttpCodesEnum.HTTP_BAD_GATEWAY);
      const row = value as Record<string, unknown>;
      const quote = row.quote;
      if (
        row.base !== 'USD' ||
        typeof quote !== 'string' ||
        !['NGN', 'GHS', 'XAF', 'EUR'].includes(quote) ||
        quote in quotes ||
        typeof row.rate !== 'string' ||
        row.rate.length > 100 ||
        typeof row.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
      ) {
        ErrorResponse(
          'Invalid FX quote fields',
          HttpCodesEnum.HTTP_BAD_GATEWAY,
        );
      }
      const observed = new Date(`${row.date}T00:00:00.000Z`);
      if (
        !Number.isFinite(observed.getTime()) ||
        observed.toISOString().slice(0, 10) !== row.date ||
        observed.getTime() > Date.now()
      ) {
        ErrorResponse(
          'Invalid FX observation date',
          HttpCodesEnum.HTTP_BAD_GATEWAY,
        );
      }
      const rate = new Money(row.rate);
      if (
        !rate.isFinite() ||
        rate.lte(0) ||
        rate.gt('1000000000000') ||
        rate.lt('0.000000000001')
      ) {
        ErrorResponse('Invalid FX quote rate', HttpCodesEnum.HTTP_BAD_GATEWAY);
      }
      quotes[quote as Exclude<keyof FxQuotes, 'USD'>] = {
        rate: rate.toFixed(18),
        observedDate: row.date,
      };
    }
    if (FIAT_CURRENCIES.some((currency) => !quotes[currency]))
      ErrorResponse('Missing FX quote', HttpCodesEnum.HTTP_BAD_GATEWAY);
    return quotes as FxQuotes;
  } catch (error) {
    catchBlockResponse(error);
  }
}
