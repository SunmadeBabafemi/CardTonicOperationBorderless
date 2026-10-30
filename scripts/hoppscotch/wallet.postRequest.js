const payload =
  typeof pw.response.body === 'string'
    ? JSON.parse(pw.response.body)
    : pw.response.body;
const wallet = payload && payload.data;
if (
  pw.response.status === 201 &&
  payload.success === true &&
  wallet &&
  typeof wallet.id === 'string' &&
  typeof wallet.currency === 'string'
) {
  pw.env.set(`${wallet.currency.toLowerCase()}_wallet_id`, wallet.id);
}
