import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Currency } from '@core/common/money/currency';

export interface IssueAccountInput {
  walletId: string;
  currency: Currency;
  accountName: string;
}

export interface IssuedAccount {
  accountNumber: string;
  accountName: string;
  bankName: string;
}

/** A bank that issues collection account numbers (Providus, VFD, …). */
export abstract class BankProvider {
  abstract readonly name: string;
  abstract issueAccount(input: IssueAccountInput): Promise<IssuedAccount>;
}

/** Simulated bank: issues a random 10-digit account number immediately. */
@Injectable()
export class SandboxBankProvider extends BankProvider {
  readonly name = 'borderflow-sandbox';

  issueAccount(input: IssueAccountInput): Promise<IssuedAccount> {
    return Promise.resolve({
      accountNumber: `9${randomInt(0, 1e9).toString().padStart(9, '0')}`,
      accountName: input.accountName,
      bankName: 'BorderFlow Sandbox Bank',
    });
  }
}
