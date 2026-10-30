import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { HttpCodesEnum } from '@core/common/enums/httpCodes.enum';
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  CURRENCIES,
  Currency,
  FIAT,
  RateSource,
} from '@core/common/money/currency';
import { Money } from '@core/common/money/money';
import { FxProvider } from './fx.provider';
import { RedisCacheService } from '../redis/redis.service';
import type { RateView, SelectedFx } from './fx.types';

export type { SelectedFx } from './fx.types';

interface RateRow {
  id: string;
  currency: Currency;
  units_per_usd: string;
  source: RateSource;
  provider: string;
  observed_date: string | null;
  fetched_at: Date;
}
type RateSet = Record<Currency, RateView>;

const RATE_COLUMNS = `id, currency, units_per_usd, source, provider,
  to_char(observed_date, 'YYYY-MM-DD') AS observed_date, fetched_at`;

const toView = (row: RateRow): RateView => ({
  id: row.id,
  currency: row.currency,
  unitsPerUsd: row.units_per_usd,
  source: row.source,
  provider: row.provider,
  observedDate: row.observed_date,
  fetchedAt: new Date(row.fetched_at).toISOString(),
});

/**
 * Reads exchange rates from the `rates` table. The latest LIVE row per
 * currency is used while fresh; a failed refresh falls back to recent LIVE
 * rows (stale) or to the FIXED rate table. Selections are shared via Redis.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private refreshing?: Promise<RateSet>;
  private readonly selecting = new Map<string, Promise<SelectedFx>>();

  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
    private readonly provider: FxProvider,
    private readonly cache: RedisCacheService,
  ) {}

  private isComplete(
    rates: Partial<Record<Currency, RateView>>,
  ): rates is RateSet {
    try {
      return CURRENCIES.every((currency) => {
        const row = rates[currency];
        if (
          !row ||
          typeof row.unitsPerUsd !== 'string' ||
          row.unitsPerUsd.length > 100 ||
          !/^\d+(?:\.\d+)?$/.test(row.unitsPerUsd)
        )
          return false;
        const rate = new Money(row.unitsPerUsd);
        if (
          !rate.isFinite() ||
          rate.lt('0.000000000001') ||
          rate.gt('1000000000000')
        )
          return false;
        return currency !== Currency.USDX || rate.eq(1);
      });
    } catch {
      return false;
    }
  }

  private isUsable(rates: Partial<Record<Currency, RateView>>): boolean {
    if (!this.isComplete(rates)) return false;
    const maxAge = this.config.getOrThrow<number>('FX_MAX_AGE_DAYS') * 86400000;
    return CURRENCIES.every((currency) => {
      if (currency === Currency.USDX) return true;
      const observed = Date.parse(
        `${rates[currency].observedDate}T00:00:00.000Z`,
      );
      return (
        Number.isFinite(observed) &&
        observed <= Date.now() &&
        Date.now() - observed <= maxAge
      );
    });
  }

  private oldestFetch(rates: RateSet): number {
    return Math.min(
      ...CURRENCIES.map((currency) => Date.parse(rates[currency].fetchedAt)),
    );
  }

  private cacheKey(): string {
    return (
      'fx:rates:' +
      createHash('sha256')
        .update(
          JSON.stringify([
            this.config.getOrThrow<string>('FX_MODE'),
            this.config.getOrThrow<string>('FX_BASE_URL'),
            this.config.getOrThrow<number>('FX_REFRESH_SECONDS'),
            this.config.getOrThrow<number>('FX_MAX_AGE_DAYS'),
          ]),
        )
        .digest('hex')
    );
  }

  async select(): Promise<SelectedFx> {
    try {
      const key = this.cacheKey();
      const cached = await this.cache.get(key);
      if (cached) {
        try {
          const data = JSON.parse(cached) as SelectedFx;
          const live = ['LIVE', 'STALE_CACHE'].includes(data.source);
          if (
            this.isComplete(data.rates) &&
            CURRENCIES.every(
              (currency) =>
                data.rates[currency]?.source ===
                (live ? RateSource.LIVE : RateSource.FIXED),
            ) &&
            (!live || this.isUsable(data.rates)) &&
            (data.source !== 'LIVE' ||
              Date.now() - this.oldestFetch(data.rates as RateSet) <
                this.config.getOrThrow<number>('FX_REFRESH_SECONDS') * 1000)
          )
            return data;
        } catch {
          this.logger.warn('Ignoring malformed Redis rate selection');
        }
      }
      let pending = this.selecting.get(key);
      if (!pending) {
        pending = this.selectUncached()
          .then(async (selection) => {
            const refreshTtl =
              this.config.getOrThrow<number>('FX_REFRESH_SECONDS');
            const ttl =
              selection.source === 'LIVE'
                ? Math.max(
                    1,
                    Math.floor(
                      refreshTtl -
                        (Date.now() -
                          this.oldestFetch(selection.rates as RateSet)) /
                          1000,
                    ),
                  )
                : selection.source === 'FIXED'
                  ? refreshTtl
                  : Math.min(5, refreshTtl);
            await this.cache.set(key, JSON.stringify(selection), ttl);
            return selection;
          })
          .finally(() => this.selecting.delete(key));
        this.selecting.set(key, pending);
      }
      return await pending;
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  private async latest(
    source: RateSource,
  ): Promise<Partial<Record<Currency, RateView>>> {
    const rows = await this.database.query<RateRow[]>(
      `SELECT DISTINCT ON (currency) ${RATE_COLUMNS} FROM rates
       WHERE source = $1 ORDER BY currency, fetched_at DESC, id DESC`,
      [source],
    );
    return Object.fromEntries(rows.map((row) => [row.currency, toView(row)]));
  }

  private async selectUncached(): Promise<SelectedFx> {
    const fixedMode = this.config.getOrThrow<string>('FX_MODE') === 'fixed';
    if (!fixedMode) {
      const latest = await this.latest(RateSource.LIVE);
      const usable = this.isUsable(latest);
      const refreshAfter =
        this.config.getOrThrow<number>('FX_REFRESH_SECONDS') * 1000;
      if (
        usable &&
        Date.now() - this.oldestFetch(latest as RateSet) < refreshAfter
      )
        return { rates: latest, source: 'LIVE', stale: false };
      try {
        return {
          rates: await this.refreshShared(),
          source: 'LIVE',
          stale: false,
        };
      } catch {
        this.logger.warn(
          'Rate refresh failed; selecting stored fallback rates',
        );
        if (usable)
          return { rates: latest, source: 'STALE_CACHE', stale: true };
      }
    }
    const fixed = await this.latest(RateSource.FIXED);
    if (!this.isComplete(fixed))
      ErrorResponse('No complete rate table is available', 503);
    return {
      rates: fixed,
      source: fixedMode ? 'FIXED' : 'FIXED_FALLBACK',
      stale: false,
    };
  }

  /** One provider call per process at a time. */
  private refreshShared(): Promise<RateSet> {
    if (!this.refreshing)
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }

  /** Fetches provider rates and appends one LIVE row per currency. */
  private async refresh(): Promise<RateSet> {
    const quotes = await this.provider.fetchQuotes();
    const fetchedAt = new Date();
    const pending = Object.fromEntries(
      CURRENCIES.map((currency) => {
        const quote = quotes[FIAT[currency]];
        return [
          currency,
          quote && {
            id: '',
            currency,
            unitsPerUsd: quote.rate,
            source: RateSource.LIVE,
            provider: 'frankfurter-v2',
            observedDate: quote.observedDate,
            fetchedAt: fetchedAt.toISOString(),
          },
        ];
      }),
    ) as Partial<Record<Currency, RateView>>;
    if (!this.isUsable(pending))
      ErrorResponse(
        'FX provider data is incomplete or too old',
        HttpCodesEnum.HTTP_BAD_GATEWAY,
      );
    return this.database.transaction(async (manager) => {
      const saved: Partial<RateSet> = {};
      for (const currency of CURRENCIES) {
        const row = pending[currency]!;
        const [inserted] = await manager.query<RateRow[]>(
          `INSERT INTO rates(currency, units_per_usd, source, provider, observed_date, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${RATE_COLUMNS}`,
          [
            currency,
            row.unitsPerUsd,
            row.source,
            row.provider,
            row.observedDate,
            fetchedAt,
          ],
        );
        saved[currency] = toView(inserted);
      }
      return saved as RateSet;
    });
  }

  /** Scheduled refresh: store new LIVE rates and drop the shared selection. */
  async refreshNow(): Promise<void> {
    await this.refreshShared();
    await this.cache.del(this.cacheKey());
  }

  /** Exact rate rows by id, for re-pricing a cached quote. */
  async findRates(ids: string[]): Promise<Map<string, RateView>> {
    const rows = await this.database.query<RateRow[]>(
      `SELECT ${RATE_COLUMNS} FROM rates WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, toView(row)]));
  }

  rate(selection: SelectedFx, from: Currency, to: Currency): string {
    return new Money(selection.rates[to]!.unitsPerUsd)
      .div(selection.rates[from]!.unitsPerUsd)
      .toFixed(18, Money.ROUND_DOWN);
  }

  metadata(selection: SelectedFx, from?: Currency, to?: Currency) {
    const rows = (from && to ? [from, to] : CURRENCIES)
      .map((currency) => selection.rates[currency])
      .filter((row): row is RateView => row !== undefined);
    const dates = rows
      .map((row) => row.observedDate)
      .filter((date): date is string => date !== null)
      .sort();
    const fetched = rows.map((row) => row.fetchedAt).sort();
    const live = rows.every((row) => row.source === RateSource.LIVE);
    return {
      ...(selection.quoteId
        ? {
            quoteId: selection.quoteId,
            quoteExpiresAt: selection.quoteExpiresAt,
          }
        : {}),
      ...(from && to
        ? {
            sourceRateId: selection.rates[from]!.id,
            destinationRateId: selection.rates[to]!.id,
          }
        : {}),
      source: selection.source,
      provider: [...new Set(rows.map((row) => row.provider))].join(','),
      stale: selection.stale,
      observedDate: dates[0] ?? null,
      refreshedAt: live ? (fetched[0] ?? null) : null,
      configuredAt: live ? null : (fetched[0] ?? null),
    };
  }

  async rates() {
    try {
      const selection = await this.select();
      return {
        ...this.metadata(selection),
        rates: CURRENCIES.flatMap((from) =>
          CURRENCIES.map((to) => ({
            fromCurrency: from,
            toCurrency: to,
            rate: this.rate(selection, from, to),
            ...this.metadata(selection, from, to),
          })),
        ),
      };
    } catch (error) {
      catchBlockResponse(error);
    }
  }
}
