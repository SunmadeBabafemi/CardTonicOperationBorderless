import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

function run(script: string, status: number, body: unknown) {
  const values = new Map([
    ['access_token', 'previous-access'],
    ['refresh_token', 'previous-refresh'],
    ['cngn_wallet_id', 'previous-wallet'],
  ]);
  const assertions: boolean[] = [];
  runInNewContext(
    readFileSync(
      join('scripts', 'hoppscotch', `${script}.postRequest.js`),
      'utf8',
    ),
    {
      pw: {
        response: { status, body },
        env: { set: (key: string, value: string) => values.set(key, value) },
        test: (_name: string, fn: () => void) => fn(),
        expect: (actual: unknown) => ({
          toBe: (expected: unknown) => assertions.push(actual === expected),
        }),
      },
    },
  );
  return { values, assertions };
}

describe('Hoppscotch post-request scripts', () => {
  it.each([200, 201])(
    'stores the response tokens and clears previous wallets for a new account (%s)',
    (status) => {
      const result = run('auth', status, {
        success: true,
        data: {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          user: { wallets: [] },
        },
      });
      expect(result.values.get('access_token')).toBe('new-access');
      expect(result.values.get('refresh_token')).toBe('new-refresh');
      expect(result.values.get('cngn_wallet_id')).toBe('');
      expect(result.values.get('usdx_wallet_id')).toBe('');
      expect(result.assertions).toEqual([true]);
    },
  );

  it('handles JSON text and stores existing wallets on login or refresh', () => {
    const result = run(
      'auth',
      200,
      JSON.stringify({
        success: true,
        data: {
          accessToken: 'new-access',
          refreshToken: 'rotated-refresh',
          user: {
            wallets: [
              { id: 'existing-ngn', currency: 'cNGN' },
              { id: 'existing-usd', currency: 'USDx' },
            ],
          },
        },
      }),
    );
    expect(result.values.get('refresh_token')).toBe('rotated-refresh');
    expect(result.values.get('cngn_wallet_id')).toBe('existing-ngn');
    expect(result.values.get('usdx_wallet_id')).toBe('existing-usd');
    expect(result.values.get('eurx_wallet_id')).toBe('');
  });

  it.each([
    [401, { success: false, data: null }],
    [200, { success: true, data: { accessToken: 'partial' } }],
  ])(
    'retains credentials when authentication fails or the response is incomplete (%s)',
    (status, body) => {
      const result = run('auth', status as number, body);
      expect(result.values.get('access_token')).toBe('previous-access');
      expect(result.values.get('refresh_token')).toBe('previous-refresh');
      expect(result.assertions).toEqual([false]);
    },
  );

  it.each(['SWAP', 'TRANSFER'])(
    'stores a %s quote ID from its preview response',
    (type) => {
      const result = run('quote', 200, {
        success: true,
        data: { type, quoteId: 'new-quote' },
      });
      expect(
        result.values.get(
          type === 'SWAP' ? 'swap_quote_id' : 'transfer_quote_id',
        ),
      ).toBe('new-quote');
      expect(result.values.get('access_token')).toBe('previous-access');
    },
  );

  it('does not store a quote from a failed preview response', () => {
    const result = run('quote', 409, { success: false, data: null });
    expect(result.values.has('swap_quote_id')).toBe(false);
    expect(result.values.has('transfer_quote_id')).toBe(false);
  });

  it('saves a created wallet under its currency and ignores failed creation', () => {
    const created = run('wallet', 201, {
      success: true,
      data: { id: 'ghs-wallet', currency: 'cGHS' },
    }).values;
    expect(created.get('cghs_wallet_id')).toBe('ghs-wallet');
    expect(created.get('cngn_wallet_id')).toBe('previous-wallet');
    expect(
      run('wallet', 409, { success: false }).values.get('cngn_wallet_id'),
    ).toBe('previous-wallet');
  });

  it('saves an issued virtual bank account number from a wallet or account response', () => {
    expect(
      run('virtualBankAccount', 200, {
        success: true,
        data: {
          id: 'wallet',
          virtualBankAccount: { status: 'ACTIVE', accountNumber: '9012345678' },
        },
      }).values.get('vba_account_number'),
    ).toBe('9012345678');
    expect(
      run('virtualBankAccount', 202, {
        success: true,
        data: { status: 'ACTIVE', accountNumber: '9087654321' },
      }).values.get('vba_account_number'),
    ).toBe('9087654321');
    expect(
      run('virtualBankAccount', 200, {
        success: true,
        data: {
          virtualBankAccount: { status: 'PENDING', accountNumber: null },
        },
      }).values.has('vba_account_number'),
    ).toBe(false);
  });

  it('saves the dev-tools signed webhook body and signature', () => {
    const signed = run('devToolsSignature', 200, {
      success: true,
      data: { body: '{"amount":"1"}', signature: 'a'.repeat(128) },
    }).values;
    expect(signed.get('vba_webhook_body')).toBe('{"amount":"1"}');
    expect(signed.get('vba_webhook_signature')).toBe('a'.repeat(128));
    expect(
      run('devToolsSignature', 404, { success: false }).values.has(
        'vba_webhook_body',
      ),
    ).toBe(false);
  });

  it('clears credentials only after successful logout', () => {
    const success = run('logout', 200, {});
    expect([...success.values.values()].every((value) => value === '')).toBe(
      true,
    );
    expect(success.values.get('usdx_wallet_id')).toBe('');
    expect(run('logout', 401, {}).values.get('access_token')).toBe(
      'previous-access',
    );
  });
});
