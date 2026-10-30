// Saves the account number once the background job has issued it.
const payload =
  typeof pw.response.body === 'string'
    ? JSON.parse(pw.response.body)
    : pw.response.body;
const data = payload && payload.data;
const account = data && (data.virtualBankAccount || data);
if (
  pw.response.status >= 200 &&
  pw.response.status < 300 &&
  payload.success === true &&
  account &&
  account.status === 'ACTIVE' &&
  typeof account.accountNumber === 'string'
) {
  pw.env.set('vba_account_number', account.accountNumber);
}
