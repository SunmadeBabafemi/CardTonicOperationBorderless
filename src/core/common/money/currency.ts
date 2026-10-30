export enum Currency {
  CNGN = 'cNGN',
  CGHS = 'cGHS',
  CXAF = 'cXAF',
  USDX = 'USDx',
  EURX = 'EURx',
}

export const CURRENCIES = Object.values(Currency);
export const FIAT_CURRENCIES = ['USD', 'NGN', 'GHS', 'XAF', 'EUR'] as const;
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];
export const FIAT: Record<Currency, FiatCurrency> = {
  [Currency.CNGN]: 'NGN',
  [Currency.CGHS]: 'GHS',
  [Currency.CXAF]: 'XAF',
  [Currency.USDX]: 'USD',
  [Currency.EURX]: 'EUR',
};

export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  SWAP = 'SWAP',
  TRANSFER = 'TRANSFER',
}

export enum TransactionChannel {
  API = 'API',
  VIRTUAL_ACCOUNT = 'VIRTUAL_ACCOUNT',
}

/** PENDING until the background job issues account details; FAILED after retries run out. */
export enum VirtualBankAccountStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  FAILED = 'FAILED',
  INACTIVE = 'INACTIVE',
}

/** USER wallets hold customer money; one SYSTEM wallet per currency is the counterparty. */
export enum WalletKind {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

export enum LedgerEntryType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export enum RateSource {
  LIVE = 'LIVE',
  FIXED = 'FIXED',
}

/** Quoted in a single SQL list for CHECK constraints. */
export const sqlList = (values: readonly string[]) =>
  values.map((value) => `'${value}'`).join(', ');
