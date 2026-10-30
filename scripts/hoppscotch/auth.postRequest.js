// Select BorderFlow Local before sending this request. Never log tokens.
const payload =
  typeof pw.response.body === 'string'
    ? JSON.parse(pw.response.body)
    : pw.response.body;
const data = payload && payload.data;
const success =
  pw.response.status >= 200 &&
  pw.response.status < 300 &&
  payload.success === true &&
  data &&
  typeof data.accessToken === 'string' &&
  data.accessToken.length > 0 &&
  typeof data.refreshToken === 'string' &&
  data.refreshToken.length > 0;
pw.test('Authentication returns an access token and a refresh token', () => {
  pw.expect(Boolean(success)).toBe(true);
});
if (success) {
  pw.env.set('access_token', data.accessToken);
  pw.env.set('refresh_token', data.refreshToken);
  // One variable per currency wallet; cleared for an account without wallets.
  const wallets = (data.user && data.user.wallets) || [];
  for (const currency of ['cNGN', 'cGHS', 'cXAF', 'USDx', 'EURx']) {
    const wallet = wallets.find((row) => row.currency === currency);
    pw.env.set(`${currency.toLowerCase()}_wallet_id`, wallet ? wallet.id : '');
  }
}
