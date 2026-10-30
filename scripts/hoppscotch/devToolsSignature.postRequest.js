// Saves the signed body and signature for the bank-credit webhook request.
const payload =
  typeof pw.response.body === 'string'
    ? JSON.parse(pw.response.body)
    : pw.response.body;
const data = payload && payload.data;
if (
  pw.response.status === 200 &&
  payload.success === true &&
  data &&
  typeof data.body === 'string' &&
  typeof data.signature === 'string'
) {
  pw.env.set('vba_webhook_body', data.body);
  pw.env.set('vba_webhook_signature', data.signature);
}
