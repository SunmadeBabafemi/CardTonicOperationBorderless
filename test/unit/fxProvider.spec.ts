import { ConfigService } from '@nestjs/config';
import { parse } from 'lossless-json';
import {
  FrankfurterProvider,
  parseProviderQuotes,
} from '@core/modules/fx/fx.provider';

const today = new Date().toISOString().slice(0, 10);
const valid = () =>
  ['NGN', 'GHS', 'XAF', 'EUR'].map((quote) => ({
    base: 'USD',
    quote,
    rate: '1.23456789123456789',
    date: today,
  }));

describe('external FX adapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves numeric JSON tokens before binary floating point can change them', () => {
    const raw = JSON.stringify(valid()).replaceAll(
      '"1.23456789123456789"',
      '1.23456789123456789',
    );
    const quotes = parseProviderQuotes(parse(raw, null, (value) => value));
    expect(quotes.NGN.rate).toBe('1.234567891234567890');
    expect(quotes.USD.rate).toBe('1');
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '1e1000'])(
    'rejects unsafe provider rate %s',
    (rate) => {
      const rows = valid();
      rows[0].rate = rate;
      expect(() => parseProviderQuotes(rows)).toThrow();
    },
  );

  it('rejects incomplete, duplicate, wrong-base, and invalid-date observations', () => {
    expect(() => parseProviderQuotes(valid().slice(1))).toThrow();
    const duplicate = valid();
    duplicate[1].quote = 'NGN';
    expect(() => parseProviderQuotes(duplicate)).toThrow();
    const wrongBase = valid();
    wrongBase[0].base = 'EUR';
    expect(() => parseProviderQuotes(wrongBase)).toThrow();
    const invalid = valid();
    invalid[0].date = '2026-02-30';
    expect(() => parseProviderQuotes(invalid)).toThrow();
  });

  it.each([429, 500, 503])(
    'treats HTTP %s as provider failure',
    async (status) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('{}', { status }));
      const provider = new FrankfurterProvider(
        new ConfigService({
          FX_BASE_URL: 'https://example.com',
          FX_TIMEOUT_MS: 100,
        }),
      );
      await expect(provider.fetchQuotes()).rejects.toThrow();
    },
  );

  it('treats malformed JSON and network timeouts as provider failure', async () => {
    const mocked = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('invalid'))
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
    const provider = new FrankfurterProvider(
      new ConfigService({
        FX_BASE_URL: 'https://example.com',
        FX_TIMEOUT_MS: 100,
      }),
    );
    await expect(provider.fetchQuotes()).rejects.toThrow();
    await expect(provider.fetchQuotes()).rejects.toThrow();
    expect(mocked).toHaveBeenCalledTimes(2);
  });
});
