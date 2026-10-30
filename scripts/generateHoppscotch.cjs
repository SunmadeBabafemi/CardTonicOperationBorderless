const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const specification = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
const templates = {
  RegisterDto: {
    firstName: 'Ada',
    lastName: 'Okafor',
    email: '<<email>>',
    phone: '+2348012345678',
    password: '<<password>>',
  },
  LoginDto: { identifier: '<<email>>', password: '<<password>>' },
  RefreshDto: { refreshToken: '<<refresh_token>>' },
  CreateWalletDto: { currency: 'cNGN' },
  DepositDto: { amount: '150000.000000' },
  SwapDto: {
    toWalletId: '<<usdx_wallet_id>>',
    amount: '50000.000000',
    quoteId: '<<swap_quote_id>>',
  },
  QuoteDto: {
    fromWalletId: '<<cngn_wallet_id>>',
    toWalletId: '<<usdx_wallet_id>>',
    amount: '50000.000000',
  },
  TransferDto: {
    fromWalletId: '<<cngn_wallet_id>>',
    toWalletId: '<<recipient_wallet_id>>',
    amount: '10000.000000',
    quoteId: '<<transfer_quote_id>>',
  },
  // Sent verbatim: the dev-tools signing request saves the exact signed body.
  BankCreditWebhookDto: '<<vba_webhook_body>>',
  SignBankCreditDto: {
    accountNumber: '<<vba_account_number>>',
    amount: '50000.00',
    sourceAccountName: 'ADA OKAFOR',
    narration: 'Wallet top-up',
  },
};
// Wallet-scoped requests default to the cNGN wallet; edit the variable to use another.
const variables = {
  walletId: 'cngn_wallet_id',
  transactionId: 'transaction_id',
};
const none = { authType: 'none', authActive: true };
const folder = (name) => ({
  v: 2,
  name,
  folders: [],
  requests: [],
  auth: none,
  headers: [],
});
const root = folder('BorderFlow — Operation Borderless');
const requests = [];
const parameter = (key, value, active = true, description = '') => ({
  key,
  value,
  active,
  description,
});

function add(moduleName, name, method, path, operation = {}, templateOverride) {
  const schema = operation.requestBody?.content?.['application/json']?.schema;
  const dto = schema?.$ref?.split('/').pop();
  if (dto && !templates[dto])
    throw new Error(`Missing request template: ${dto}`);
  const body = dto
    ? {
        contentType: 'application/json',
        body:
          typeof templates[dto] === 'string' && !templateOverride
            ? templates[dto]
            : JSON.stringify(templateOverride ?? templates[dto], null, 2),
      }
    : { contentType: null, body: null };
  const privateRoute = operation.security?.some((entry) => entry.bearer);
  const headers = [
    parameter(
      'Accept',
      moduleName === 'Documentation' && path === '/docs'
        ? 'text/html'
        : 'application/json',
    ),
  ];
  if (dto) headers.push(parameter('Content-Type', 'application/json'));
  if (
    operation.parameters?.some(
      (entry) =>
        entry.in === 'header' && entry.name.toLowerCase() === 'idempotency-key',
    )
  ) {
    headers.push(
      parameter(
        'Idempotency-Key',
        '<<idempotency_key>>',
        true,
        'New key per operation; same key only for identical retries.',
      ),
    );
  }
  if (
    operation.parameters?.some(
      (entry) =>
        entry.in === 'header' &&
        entry.name.toLowerCase() === 'x-webhook-signature',
    )
  ) {
    headers.push(
      parameter(
        'X-Webhook-Signature',
        '<<vba_webhook_signature>>',
        true,
        'Set by "Sign a bank credit webhook" (Dev tools) together with vba_webhook_body.',
      ),
    );
  }
  const params = (operation.parameters ?? [])
    .filter((entry) => entry.in === 'query')
    .map((entry) => {
      const value =
        entry.name === 'limit'
          ? '20'
          : entry.name === 'cursor'
            ? '<<history_cursor>>'
            : (entry.schema?.enum?.[0] ?? '');
      return parameter(
        entry.name,
        String(value),
        entry.required || entry.name === 'limit',
        entry.description ?? '',
      );
    });
  const endpoint =
    '<<base_url>>' +
    path.replace(/\{([^}]+)\}/g, (_, key) => {
      if (!variables[key]) throw new Error(`Missing path variable: ${key}`);
      return `<<${variables[key]}>>`;
    });
  const request = {
    v: '11',
    name,
    method,
    endpoint,
    params,
    headers,
    auth: privateRoute
      ? { authType: 'bearer', authActive: true, token: '<<access_token>>' }
      : none,
    body,
    preRequestScript: '',
    testScript: (() => {
      const script = [
        '/v1/auth/register',
        '/v1/auth/login',
        '/v1/auth/refresh',
      ].includes(path)
        ? 'auth'
        : path === '/v1/wallets' && method === 'POST'
          ? 'wallet'
          : path === '/v1/auth/logout'
            ? 'logout'
            : path === '/v1/rates/quotes'
              ? 'quote'
              : path === '/v1/wallets/{walletId}/virtual-bank-account' ||
                  (path === '/v1/wallets/{walletId}' && method === 'GET')
                ? 'virtualBankAccount'
                : path === '/v1/dev-tools/bank-credit-signatures'
                  ? 'devToolsSignature'
                  : null;
      return script
        ? readFileSync(
            join(__dirname, 'hoppscotch', `${script}.postRequest.js`),
            'utf8',
          )
        : '';
    })(),
    requestVariables: [],
    responses: {},
  };
  let target = root.folders.find((entry) => entry.name === moduleName);
  if (!target) {
    target = folder(moduleName);
    root.folders.push(target);
  }
  target.requests.push(request);
  requests.push({
    module: moduleName,
    name,
    method,
    path,
    normalized_key: `${method} ${path.replace(/\{[^}]+\}/g, '{}')}${dto === 'QuoteDto' ? ` [${name.includes('transfer') ? 'TRANSFER' : 'SWAP'}]` : ''}${dto === 'CreateWalletDto' ? ` [${JSON.parse(body.body).currency}]` : ''}`,
    request,
  });
}
for (const [path, item] of Object.entries(specification.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (
      !['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(
        method,
      )
    )
      continue;
    add(
      operation.tags?.[0] ?? 'API',
      path === '/v1/rates/quotes'
        ? 'Preview and lock a swap rate'
        : (operation.summary ?? operation.operationId),
      method.toUpperCase(),
      path,
      operation,
    );
  }
}
if (specification.paths['/v1/rates/quotes']?.post) {
  add(
    'Rates',
    'Preview and lock a transfer rate',
    'POST',
    '/v1/rates/quotes',
    specification.paths['/v1/rates/quotes'].post,
    {
      fromWalletId: '<<cngn_wallet_id>>',
      toWalletId: '<<recipient_wallet_id>>',
      amount: '10000.000000',
    },
  );
}
if (specification.paths['/v1/wallets']?.post) {
  add(
    'Wallets',
    'Open a USDx wallet',
    'POST',
    '/v1/wallets',
    specification.paths['/v1/wallets'].post,
    { currency: 'USDx' },
  );
}
for (const [path, name] of [
  ['/docs', 'Swagger UI'],
  ['/openapi.json', 'OpenAPI JSON'],
  ['/docs-yaml', 'OpenAPI YAML'],
  ['/docs/swagger-ui-init.js', 'Swagger initialization script'],
  ['/docs/docs/swagger-ui-init.js', 'Swagger initialization alias'],
])
  add('Documentation', name, 'GET', path);
const keys = new Set(requests.map((entry) => entry.normalized_key));
if (keys.size !== requests.length) throw new Error('Duplicate API operations');
const write = (path, data) =>
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
write('docs/hoppscotch-collection.json', [root]);
write('docs/hoppscotch-environment.json', {
  name: 'BorderFlow Local',
  variables: [
    { key: 'base_url', value: 'http://localhost:3000', secret: false },
    { key: 'email', value: 'alice@example.com', secret: false },
    { key: 'password', value: '', secret: true },
    { key: 'access_token', value: '', secret: true },
    { key: 'refresh_token', value: '', secret: true },
    ...[
      'cngn_wallet_id',
      'cghs_wallet_id',
      'cxaf_wallet_id',
      'usdx_wallet_id',
      'eurx_wallet_id',
      'recipient_wallet_id',
      'vba_account_number',
      'vba_webhook_body',
      'vba_webhook_signature',
      'transaction_id',
      'history_cursor',
      'swap_quote_id',
      'transfer_quote_id',
    ].map((key) => ({ key, value: '', secret: false })),
    { key: 'idempotency_key', value: 'alice-operation-0001', secret: false },
  ],
});
write('docs/hoppscotch-sync-plan.json', {
  format: 'source-derived-hoppscotch-sync-plan-v3',
  status: 'prepared_for_sync',
  target_collection: null,
  authentication_note:
    'Signed JWT access tokens required on wallet/transaction operations, rate quotes, virtual bank accounts and auth profile/logout. Register/login/refresh, the rate matrix, health, and Swagger are public; the virtual bank account webhook is HMAC-signed instead. Refresh requires the single-use refresh token in its JSON body.',
  counts: {
    controller_endpoints: new Set(
      requests
        .filter((entry) => entry.module !== 'Documentation')
        .map((entry) => `${entry.method} ${entry.path}`),
    ).size,
    swagger_routes: 5,
    prepared_requests: requests.length,
    created_requests: 0,
    updated_requests: 0,
    deleted_requests: 0,
    executed_requests: 0,
  },
  sync_policy: {
    list_collections_first: true,
    select_existing_empty_collection: true,
    ask_if_multiple_candidates: true,
    matching:
      'Compare method and full path; normalize path parameter names and ignore host/query/trailing slash. For POST /v1/rates/quotes, also match the request name (swap or transfer preview). Review unresolved variables or ambiguous concrete IDs.',
    preserve_unrelated_metadata_and_scripts: true,
    update_existing_matches: true,
    delete_existing_requests: false,
    execute_requests: false,
  },
  requests,
});
console.log(
  `Prepared ${requests.length} Hoppscotch requests from OpenAPI; no remote changes.`,
);
