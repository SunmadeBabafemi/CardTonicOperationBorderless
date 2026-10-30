import { HttpCodesEnum } from '@core/common/enums/httpCodes.enum';
import { ErrorResponse } from '@core/common/helpers/response';
import Decimal from 'decimal.js';

export const Money = Decimal.clone({
  precision: 60,
  rounding: Decimal.ROUND_DOWN,
});
export const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,6})?$/;
const MAX_AMOUNT = '1000000000000000';
const MAX_BALANCE = '999999999999999999999999.999999';

export function parseAmount(value: string): string {
  if (typeof value !== 'string' || !AMOUNT_PATTERN.test(value)) {
    ErrorResponse(
      'Amount must be a decimal string with at most six decimal places',
      400,
    );
  }
  const amount = new Money(value);
  if (amount.lte(0) || amount.gt(MAX_AMOUNT)) {
    ErrorResponse(
      'Amount must be positive and no greater than 1000000000000000',
      HttpCodesEnum.HTTP_UNPROCESSABLE_ENTITY,
    );
  }
  return amount.toFixed(6);
}

export function assertBalanceBounds(value: Decimal): void {
  if (!value.isFinite() || value.abs().gt(MAX_BALANCE)) {
    ErrorResponse(
      'The operation exceeds the supported balance range',
      HttpCodesEnum.HTTP_UNPROCESSABLE_ENTITY,
    );
  }
}

export function convertAmount(amount: string, rate: string): string {
  const result = new Money(amount)
    .mul(rate)
    .toDecimalPlaces(6, Money.ROUND_DOWN);
  assertBalanceBounds(result);
  if (result.lte(0)) {
    ErrorResponse(
      'The destination amount is below 0.000001',
      HttpCodesEnum.HTTP_UNPROCESSABLE_ENTITY,
    );
  }
  return result.toFixed(6);
}
