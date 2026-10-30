import type { Currency, TransactionType } from '@core/common/money/currency';

export enum QuoteType {
  SWAP = 'SWAP',
  TRANSFER = 'TRANSFER',
}
export interface QuoteInput {
  fromWalletId: string;
  toWalletId: string;
  amount: string;
}
export interface QuoteMovement {
  type: TransactionType;
  fromWalletId: string;
  toWalletId: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  amount: string;
  quoteId?: string;
}
