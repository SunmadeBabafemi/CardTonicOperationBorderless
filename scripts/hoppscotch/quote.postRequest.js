const payload =
  typeof pw.response.body === 'string'
    ? JSON.parse(pw.response.body)
    : pw.response.body;
const data = payload && payload.data;
if (
  pw.response.status === 200 &&
  payload &&
  payload.success === true &&
  data &&
  typeof data.quoteId === 'string' &&
  data.quoteId.length > 0
) {
  if (data.type === 'SWAP') pw.env.set('swap_quote_id', data.quoteId);
  if (data.type === 'TRANSFER') pw.env.set('transfer_quote_id', data.quoteId);
}
