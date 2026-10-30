import {
  parseAmount,
  convertAmount,
  Money,
  assertBalanceBounds,
} from '@core/common/money/money';

describe('decimal money contract', () => {
  it('preserves exact decimal addition and canonicalizes equivalent amounts', () => {
    expect(new Money('0.1').plus('0.2').toFixed(6)).toBe('0.300000');
    expect(parseAmount('1')).toBe(parseAmount('1.000000'));
    expect(parseAmount('1000000000000000')).toBe('1000000000000000.000000');
  });

  it.each([
    '0',
    '-1',
    '1e3',
    'NaN',
    'Infinity',
    '1.0000001',
    '01',
    ' 1',
    '1000000000000001',
  ])('rejects invalid amount %s', (amount) => {
    expect(() => parseAmount(amount)).toThrow();
  });

  it('rounds the destination down once using the persisted execution rate', () => {
    expect(convertAmount('1.000000', '0.333333333333333333')).toBe('0.333333');
    expect(convertAmount('150000.000000', '0.001000000000000000')).toBe(
      '150.000000',
    );
  });

  it('rejects dust and overflow instead of posting a zero or out-of-range credit', () => {
    expect(() => convertAmount('0.000001', '0.001')).toThrow();
    expect(() =>
      assertBalanceBounds(new Money('1000000000000000000000000')),
    ).toThrow();
  });
});
