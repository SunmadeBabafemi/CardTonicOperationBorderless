import type {
  Currency,
  FiatCurrency,
  RateSource,
} from '@core/common/money/currency';

/** Provider output: units of each fiat per 1 USD. */
export interface FxQuote {
  rate: string;
  observedDate: string | null;
}
export type FxQuotes = Record<FiatCurrency, FxQuote>;

/** A `rates` row in cache-friendly form. */
export interface RateView {
  id: string;
  currency: Currency;
  unitsPerUsd: string;
  source: RateSource;
  provider: string;
  observedDate: string | null;
  fetchedAt: string;
}

export type SelectionSource =
  'LIVE' | 'STALE_CACHE' | 'FIXED' | 'FIXED_FALLBACK';

export interface SelectedFx {
  rates: Partial<Record<Currency, RateView>>;
  source: SelectionSource;
  stale: boolean;
  quoteId?: string;
  quoteExpiresAt?: string;
}
