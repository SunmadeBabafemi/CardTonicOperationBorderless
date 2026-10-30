**BorderFlow — Operation Borderless**

A NestJS backend for a simulated stablecoin wallet. Each user holds one wallet per stablecoin. Deposit (directly or through a virtual bank account), swap between your wallets, and send to other users, with every movement recorded in a wallet ledger, atomic postings and durable idempotency. Rates refresh every 6 hours.

Assets: `cNGN`, `cGHS`, `cXAF`, `USDx`, `EURx`. All tokens and funding are simulated. Each token is assumed to track its corresponding fiat currency 1:1.

**Run with Docker**

Prerequisites: Docker Engine/Desktop with its daemon running, and Docker Compose v2.

Generate a signing key once and keep it in your deployment secret store (or the untracked `.env` file). For a local shell:

```bash
export AUTH_JWT_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(64).toString('base64url'))")"
docker compose up
```

Compose builds the API, waits for PostgreSQL and Redis, runs migrations and seeds automatically during application initialization, and starts the API. No provider account is required. The API requires `AUTH_JWT_SECRET`; retain the same secret across restarts to keep existing JWT signatures valid. On subsequent source changes, run `docker compose up --build`.

- API: `http://localhost:3000/v1`
- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`, also committed at [docs/openapi.json](docs/openapi.json)
- Liveness: `http://localhost:3000/health/live`
- Readiness: `http://localhost:3000/health/ready`
- Host PostgreSQL port: `5434`
- Host Redis port: `6379`

Use deterministic synthetic rates for a fully offline demonstration after images/dependencies are available:

```bash
FX_MODE=fixed docker compose up
```

`docker compose down` preserves the named database volume. The example database credentials are local sandbox defaults.

**Host development**

Use Node.js 24 LTS (see `.nvmrc`) and the pinned Yarn version in `package.json`.

```bash
corepack enable
yarn install --frozen-lockfile
cp .env.example .env
# Generate a key and set AUTH_JWT_SECRET in .env before starting the API:
node -e "console.log(require('node:crypto').randomBytes(64).toString('base64url'))"
docker compose up -d database redis
yarn start:dev
```

If a global Yarn shim is unavailable, use `corepack yarn` in place of `yarn`. Configuration is validated at startup. Set `DATABASE_URL` for a different local PostgreSQL installation; runtime always uses migrations with `synchronize: false`.

```bash
yarn typecheck
yarn lint
yarn format:check
yarn build
yarn start
```

Builds use [SWC through the Nest CLI](https://docs.nestjs.com/recipes/swc). `yarn build` produces compact CommonJS JavaScript in `dist`, preserving class names and decorator metadata for dependency injection, validation, Swagger, and TypeORM. SWC resolves the TypeScript import aliases directly, so no alias-rewriting pass is needed. Production output omits source maps and declaration files. SWC performs transpilation only: run `yarn typecheck` separately; CI and the Docker build both enforce this check.

`yarn start:dev` (also `yarn dev`) uses SWC watch mode with readable output, source maps, and a parallel TypeScript checker via `nest-cli.dev.json` and `.swcrc.dev.json`. Production settings live in `nest-cli.json` and `.swcrc`. Both builds clear stale files from `dist` before compilation.

Migration scripts (run with `npm run` or `yarn`) all run against `src/database/typeorm.datasource.ts` and the configured `DATABASE_URL`:

| Script                                                  | Effect                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `migration`                                             | Build, then apply pending migrations                                                             |
| `migration:run` / `migration:show` / `migration:revert` | Apply, list, or roll back the latest migration                                                   |
| `migration:generate -- AddWalletLimits`                 | Diff entities against the database into `src/database/migrations/<timestamp>-AddWalletLimits.ts` |
| `migration:create -- BackfillReferences`                | Empty named migration for hand-written SQL                                                       |
| `migration:run:prod`                                    | Apply compiled migrations from `dist/`                                                           |

Names must be PascalCase; generated files are Prettier-formatted. Generate against a database that already has every migration applied, so only real entity changes appear. Startup also runs pending migrations. `yarn docs:generate` regenerates the committed specification from the controllers and needs a reachable configured database.

**Tests**

```bash
yarn test
```

The full runner starts a uniquely named temporary PostgreSQL/Redis Compose project on an available localhost port, runs unit and HTTP/database tests, then removes only that project's resources. Docker must be running. The tests never call the public FX provider.

Alternatively, provide existing dedicated local test services:

```bash
TEST_DATABASE_URL=postgresql://borderflow:borderflow@127.0.0.1:5432/borderflow_test \
TEST_REDIS_URL=redis://127.0.0.1:6379/15 yarn test
```

The database must already exist. Only localhost targets with a database name beginning `borderflow_test` are accepted. **The API suite recreates that database's public schema.** Application databases are not valid test targets. Redis tests require localhost database 15 and clean up only their unique `borderflow_test_...` key prefix; they never flush the Redis database. Do not run two suites simultaneously against the same supplied test database.

```bash
yarn test:unit
yarn test:cov
```

The suite covers precision, identity uniqueness, all 20 conversion directions, deposits, swaps, both transfer forms, concurrent duplicates and competing spends, lock ordering, failed-posting rollback, FX failures, history, ledger invariants, and replay after application restart. API tests use the same bootstrap, migrations, and HTTP routes as runtime. CI runs type checking, lint, formatting, build, and the full suite against PostgreSQL 17 and Redis 7.

**Architecture**

The project adapts the reference NestJS application's `core`/`shared`/feature-module organization:

```text
src/
  core/
    common/       decimal rules, errors, responses, request interfaces, cron base task, OpenAPI decorators
    modules/      external FX adapter, rate selection and quotes, Redis, health checks
    core.env.ts   validated configuration
    bootstrap.ts  HTTP security, body limits, validation, request logging
  database/
    entities/     typed persistence models; numeric values stay strings
    migrations/   one initial schema: constraints, indexes, triggers, SYSTEM wallets, fixed rate seed
    queries/      shared raw wallet lookups
  shared/
    guards/       global bearer-session guard (AuthGuard)
    decorators/   @Public() and @CurrentUser()
    services/     access-token verification, wallet ownership, the ledger (only writer of balances)
    jobs/         ratesRefresh cron job (every 6 hours)
  api/
    auth/                 registration, login, refresh rotation, profile and logout
    wallets/              wallets, balances, deposits and swaps
    transfers/            same-currency and cross-currency transfers
    transactions/         transaction log lookup and cursor history
    rates/                conversion matrix and executable rate quotes
    virtualBankAccounts/  bank account details that fund a wallet, signed provider webhook
```

`AppModule` owns the `/v1` routing prefix through `RouterModule`; controllers declare local paths. Health endpoints stay outside the prefix. DTO validation and the shared `ResponseObject`, `ErrorResponse`, `catchBlockResponse`, and global filter keep contracts consistent. Controllers delegate every money movement to `LedgerService`.

```mermaid
flowchart LR
  Client --> Auth[Bearer session guard]
  Auth --> DTO[DTO validation]
  DTO --> Ownership[Wallet ownership check]
  Ownership --> Replay[Committed request replay lookup]
  Replay --> FX[Load and validate cached Redis quote if needed]
  FX --> Posting[PostgreSQL transaction]
  Posting --> Locks[Lock affected wallets in sorted order]
  Locks --> Commit[Commit transaction log + wallet ledger entries + wallet balances]
```

PostgreSQL provides exact numeric storage, foreign keys, uniqueness constraints, and atomic multi-wallet updates. TypeORM exposes those transactions and explicit row locks. NestJS provides module boundaries, dependency injection, validation, scheduling, and generated OpenAPI documentation. Redis shares the current rate selection and expiring execution quotes across API instances. PostgreSQL remains the authoritative store for rates, balances, ledger entries and transaction logs. Execution reads the exact quoted rate rows from the quote; it never fetches a newer provider rate.

**Data model and financial guarantees**

```mermaid
erDiagram
  users ||--o{ user_sessions : "signs in"
  user_sessions ||--o{ refresh_tokens : rotates
  users ||--o{ wallets : "one per currency"
  wallets ||--o{ wallet_ledgers : "money in and out"
  transaction_logs ||--|{ wallet_ledgers : "balanced entries"
  wallets ||--o| virtual_bank_accounts : "funded by"
  virtual_bank_accounts ||--o{ transaction_logs : "bank credits"
  rates ||--o{ transaction_logs : "prices conversions"
```

| Table                   | Responsibility                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                 | First and last name, required unique E.164 phone, optional unique normalized email, bcrypt password hash                                            |
| `user_sessions`         | Refresh-token family per sign-in: absolute expiry and revocation                                                                                    |
| `refresh_tokens`        | SHA-256 refresh-token hashes and single-use rotation history                                                                                        |
| `wallets`               | Holds the money: one `USER` wallet per user per currency (`balance`, unique `user_id + currency`); one `SYSTEM` wallet per currency (no user)       |
| `wallet_ledgers`        | Every movement in or out of a wallet: `CREDIT`/`DEBIT`, amount, balance before/after, sequence, linked to its transaction log                       |
| `transaction_logs`      | One row per deposit, swap or transfer: reference, type, channel, description, wallets, both amounts, rate, rate rows used, idempotency key, VBA ref |
| `rates`                 | Units of each currency per 1 USD, one row per currency per refresh (`LIVE` from the provider, `FIXED` fallback), with observation and fetch time    |
| `virtual_bank_accounts` | Bank account that funds one wallet: created `PENDING` with the wallet, issued by a background job (`ACTIVE`) or `FAILED` with a reason              |

Tables and columns are snake_case; entities and code are camelCase and map columns with `name:`. Every constraint and index is named (`pk_`, `fk_`, `uq_`, `chk_`, `idx_`), enums are `text` with named CHECK constraints, and foreign keys on money tables never cascade. Entity decorators declare the same constraints as the migration, so `npm run typeorm -- schema:log` reports no drift.

Key indexes: `uq_wallets_user_id_currency`; partial unique `uq_wallets_system_currency`; `idx_wallet_ledgers_wallet_id_created_at` (wallet statements); `idx_transaction_logs_source_wallet_id_created_at` and `idx_transaction_logs_destination_wallet_id_created_at` (history, newest first); `uq_transaction_logs_initiated_by_user_id_idempotency_key` (retries); `uq_transaction_logs_external_reference` (bank settlement IDs); `idx_rates_currency_source_fetched_at` (latest rate per currency).

Amounts and balances use `NUMERIC(30,6)`, rates use `NUMERIC(38,18)`, and decimal calculations use `decimal.js` with 60 significant digits. JSON money values are strings. User amounts must be positive, use at most six decimal places, and be no greater than `1000000000000000`. Scientific notation, leading zeros, excess precision, and numeric JSON inputs are rejected.

Six decimal places are a sandbox token policy, including cXAF. They do not represent real token contracts or fiat cash subunits. Execution rates are truncated to 18 decimals before conversion; that same stored rate computes the destination amount. Destination amounts round down to six decimals. A credit below `0.000001` is rejected. USD valuation sums unrounded components from one rate selection and rounds the total once to six decimals using half-even rounding.

Ledger entries must net to exactly zero per currency in each transaction. A deposit debits the currency's `SYSTEM` wallet and credits the user's wallet. A same-currency transfer has two entries: sender debit, receiver credit. A swap or cross-currency transfer has four: source wallet debit, source `SYSTEM` credit, destination `SYSTEM` debit, destination wallet credit. `SYSTEM` wallets carry signed balances that offset simulated funding and FX.

All balance updates, ledger entries and the transaction log use one PostgreSQL transaction. Every affected wallet is locked in deterministic ID order. Balance checks use the locked rows. `USER` balances cannot become negative (`chk_wallets_owner`). Bounded database timeouts and limited transient retries prevent indefinite waits.

Database triggers reject edits/deletes to `transaction_logs`, `wallet_ledgers` and `rates`, and reject a committed transaction log whose ledger entries do not balance. `updated_at` is maintained by a trigger on mutable tables. The tests also reconcile every wallet balance against its ledger entries. Timestamps use millisecond precision and UUID tie-breaking so JSON cursor timestamps preserve ordering.

**Request retries**

All deposit, swap, and transfer requests require `Idempotency-Key`: 8–128 letters, digits, underscores, or hyphens.

- A new operation uses a new key.
- A retry reuses its key and equivalent payload. `1` and `1.000000` are equivalent amounts.
- A successful retry returns the original HTTP status/body and transaction ID. `Idempotency-Replayed: true` identifies a replay.
- Changing the operation, amount, wallets, or quote ID under that user/key returns `409`.
- The key is stored on the transaction log and scoped to the signed-in user (`uq_transaction_logs_initiated_by_user_id_idempotency_key`) across all money endpoints. Different users may use the same key.
- Database uniqueness resolves simultaneous duplicates; replay re-reads the committed transaction log, so it survives restarts and later rate changes.
- Rejected operations commit nothing, so insufficient-funds requests can be retried with the same key after funding.

This guarantees at-most-one committed financial effect for a logical request. HTTP responses can still be lost, which is why clients retain the key until they obtain the outcome.

**Rates: sourcing, cron refresh and failure behavior**

Live mode uses the [Frankfurter v2 blended daily reference feed](https://frankfurter.dev/):

```http
GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=NGN,GHS,XAF,EUR
```

The provider requires no API key. The adapter parses numeric JSON tokens as decimal strings and validates currency coverage, base, observation dates, finite positive rates, and response shape. Each accepted refresh appends one `rates` row per currency (each stablecoin is pegged 1:1 to its fiat). These are daily reference rates, not intraday execution quotes.

The `ratesRefresh` cron job (`src/shared/jobs/ratesRefresh.job.ts`) calls the provider every 6 hours (`FX_REFRESH_CRON`, default `0 */6 * * *`) when `FX_MODE=live`, stores the new rows and clears the shared Redis selection. Requests between runs read the latest stored rows:

1. Use the latest `LIVE` row per currency while it is fresher than `FX_REFRESH_SECONDS` (default 21600 = 6 hours), shared through Redis.
2. If stale (for example, a missed cron run), attempt one shared in-process refresh with a two-second HTTP timeout.
3. On failure, use the latest `LIVE` rows if their observations are at most seven days old, marked `STALE_CACHE`.
4. Otherwise use the `FIXED` rate table, marked `FIXED_FALLBACK`.
5. `FX_MODE=fixed` uses the `FIXED` rows directly, marked `FIXED`.
6. If no complete rate set exists, FX-dependent requests return `503`; financial writes do not commit.

A conversion rate is `destination.units_per_usd / source.units_per_usd`; USD value is `balance / units_per_usd`. Each rate keeps its observation date and fetch time; `GET /v1/rates` returns all 25 pairs with the time each was last refreshed (`refreshedAt` for live rates, `configuredAt` for fixed ones).

Before a swap or cross-currency transfer, call authenticated `POST /v1/rates/quotes` with `fromWalletId`, `toWalletId` and decimal-string `amount`. If both wallets are yours it is priced as a `SWAP`, otherwise a `TRANSFER`. The response contains `quoteId`, `type`, `rate`, `sourceAmount`, `destinationAmount`, `expiresAt`, `sourceRateId` and `destinationRateId`. Redis stores the binding to the user, operation, wallets, currencies, amount and the two `rates` rows for `FX_QUOTE_TTL_SECONDS` (default 300 seconds). Execution re-derives the price from exactly those rows, checks expiry again after wallet locks, and records both rate IDs and the quote in the transaction log. A newer market rate does not change a valid quote.

Missing quote IDs on cross-currency requests return `400`. Expired/evicted quotes return `409` with `The conversion rate has expired. Please request a new rate.`; changed users, operation, wallets, or amount return `409` with a quote-mismatch message. Retrying a committed request with its original body/key still returns the original result after quote expiry or a Redis outage. A quote locks pricing until expiry; it does not reserve funds.

Redis connection and command timeouts are bounded by `REDIS_TIMEOUT_MS`. An outage returns `503` for rate reads and new quoted executions; it never silently reprices a request. Readiness checks both Redis and PostgreSQL. Deposits and same-currency transfers need no rate lookup. Configure a distinct `REDIS_KEY_PREFIX` for each environment sharing a Redis deployment.

Fixed seed `sandbox-v1`, in units per USD: cNGN `1000`, cGHS `10`, cXAF `600`, USDx `1`, EURx `0.9`. These values are illustrative fixtures.

**Endpoint walkthrough**

Responses follow one shared-helper contract. Controllers return `ResponseObject.Ok(data, message, httpStatus)`. Services and guards use `ErrorResponse` for expected failures and `catchBlockResponse` at asynchronous error boundaries. Framework, validation, JSON parser, throttle, and timeout failures pass through the same global filter. Success has a numeric HTTP `status`, `data`, `success: true`, and `message`; creates and money operations use status `201`.

Errors use the following shape (the example is a missing or expired cached conversion rate):

```json
{
  "status": "failed",
  "error": "Conflict Request",
  "success": false,
  "message": "The conversion rate has expired. Please request a new rate.",
  "errorCode": 409
}
```

`errorCode` is the numeric HTTP status. `error` is a string label; validation may return a string array in `message`. Error bodies do not contain `data` or `requestId`. Request correlation is available in the `X-Request-Id` header. Unknown server errors return `500` with `Unable To Perform request at the moment`. Structured server logs retain request context and stack frames without logging SQL, request bodies, credentials, or raw exception messages. The timeout interceptor returns a normalized `408` after 30 seconds; a timeout does not establish whether a money request committed, so retry it with its original idempotency key.

| Method | Route                                        | Use                                                       |
| ------ | -------------------------------------------- | --------------------------------------------------------- |
| POST   | `/v1/auth/register`                          | Create a user and issue access/refresh tokens             |
| POST   | `/v1/auth/login`                             | Sign in with email/phone and password                     |
| POST   | `/v1/auth/refresh`                           | Rotate refresh token and issue a new JWT                  |
| GET    | `/v1/auth/profile`                           | Current user and their wallet IDs                         |
| POST   | `/v1/auth/logout`                            | Revoke the current bearer session                         |
| POST   | `/v1/wallets`                                | Open one wallet `{ "currency" }`; its VBA is queued       |
| GET    | `/v1/wallets`                                | Wallets with balances and total in USD                    |
| GET    | `/v1/wallets/:walletId`                      | One wallet                                                |
| POST   | `/v1/wallets/:walletId/deposits`             | Simulate immediate funding of that wallet                 |
| POST   | `/v1/wallets/:walletId/swaps`                | Swap into another of your wallets at a quoted rate        |
| POST   | `/v1/transfers`                              | Send to another user's wallet, converting if needed       |
| GET    | `/v1/transactions`                           | History; filters `walletId`, `type`, `currency`, `cursor` |
| GET    | `/v1/transactions/:transactionId`            | One transaction log                                       |
| GET    | `/v1/rates`                                  | All 25 rates with refresh times and provenance            |
| POST   | `/v1/rates/quotes`                           | Preview and lock a swap or transfer rate                  |
| POST   | `/v1/wallets/:walletId/virtual-bank-account` | Issue the bank account details that fund the wallet       |
| GET    | `/v1/wallets/:walletId/virtual-bank-account` | The wallet's virtual bank account                         |
| POST   | `/v1/webhooks/virtual-bank-accounts/credits` | Signed provider callback: inbound bank transfer           |

Register Alice and Bob with `firstName`, `lastName`, `phone` (required) and an optional `email`, and retain each `data.accessToken` and `data.refreshToken`. Signup creates no wallets (`data.user.wallets` is empty). Each user then opens wallets one currency at a time with authenticated `POST /v1/wallets` and `{ "currency": "cNGN" }`; the response is the zero-balance wallet with its `virtualBankAccount` in `PENDING` state. A second wallet in the same currency returns `409`. Ownership comes from the authenticated user, with no client-supplied fields. `GET /v1/wallets` and `GET /v1/wallets/:walletId` always include each wallet's `virtualBankAccount`.

Wallets, money operations, history, transaction lookup, quotes, virtual bank accounts and `/v1/auth/profile` require `Authorization: Bearer <accessToken>`. The global guard protects routes by default; registration, login, refresh, health, rates and the signed webhook are explicitly public. A user can access only their own wallets. Both participants can read a transfer; unrelated users receive `404`. Deposits remain simulated sandbox funding for the wallet owner.

New passwords require at least 12 characters and at most 72 UTF-8 bytes. Passwords are hashed asynchronously with bcrypt at cost 12 and unique salts. Inputs exceeding bcrypt’s byte limit are rejected rather than truncated. Existing scrypt hashes remain verifiable; a successful login upgrades passwords within the byte limit to bcrypt.

Access tokens are HS256-signed JWTs with `sub`, `sid`, `jti`, `iss`, `aud`, `iat`, and `exp` claims. Verification pins the algorithm, issuer, and audience and checks session expiry/revocation on every private request. `AUTH_JWT_SECRET` must be explicitly configured with at least 64 bytes of random key material. Access lifetime defaults to 3600 seconds (`AUTH_ACCESS_TTL_SECONDS`, range 60–3600).

`POST /v1/auth/refresh` accepts `{ "refreshToken": "<current-refresh-token>" }` without a valid access token. It returns a new JWT and a new single-use refresh token. Only SHA-256 digests of refresh tokens are stored. Refresh lifetime is 30 days by default (`AUTH_REFRESH_TTL_SECONDS`), with an absolute expiry that rotation does not extend. Reusing an already consumed token revokes the entire session. `POST /v1/auth/logout` revokes the current session. Signup, login, and refresh responses use `Cache-Control: no-store` and share the process-local IP limit `AUTH_RATE_LIMIT_PER_MINUTE` (default 10).

```bash
curl -s http://localhost:3000/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"firstName":"Ada","lastName":"Okafor","email":"alice@example.com","phone":"+2348012345678","password":"alice-demo-password-2026"}'
curl -s http://localhost:3000/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"firstName":"Bola","lastName":"Ade","phone":"+2348087654321","password":"bob-demo-password-2026"}'
curl -s http://localhost:3000/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"alice@example.com","password":"alice-demo-password-2026"}'
```

Names are trimmed (letters, spaces, apostrophes, hyphens and periods; up to 100 characters each). Email is trimmed and lowercased. Phone numbers must be valid international E.164 numbers. If the phone or email already exists, creation returns `409`. Sign in with either the phone number or the email.

Open the wallets you need, one currency per request (repeat with Bob's token for his cGHS wallet), and keep their IDs:

```bash
for CURRENCY in cNGN USDx; do
  curl -s http://localhost:3000/v1/wallets -H "Authorization: Bearer $ALICE_TOKEN" \
    -H 'Content-Type: application/json' -d "{\"currency\":\"$CURRENCY\"}"
done
ALICE_NGN='<alice cNGN wallet id>'
ALICE_USD='<alice USDx wallet id>'
BOB_GHS='<bob cGHS wallet id>'
```

Fund Alice's cNGN wallet, preview the swap, then execute it with the quote ID:

```bash
curl -s "http://localhost:3000/v1/wallets/$ALICE_NGN/deposits" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: alice-deposit-0001' \
  -d '{"amount":"150000.000000"}'
curl -s http://localhost:3000/v1/rates/quotes \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"fromWalletId\":\"$ALICE_NGN\",\"toWalletId\":\"$ALICE_USD\",\"amount\":\"50000.000000\"}"
SWAP_QUOTE_ID='<data.quoteId>'
curl -s "http://localhost:3000/v1/wallets/$ALICE_NGN/swaps" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: alice-swap-0001' \
  -d "{\"toWalletId\":\"$ALICE_USD\",\"amount\":\"50000.000000\",\"quoteId\":\"$SWAP_QUOTE_ID\"}"
```

With fixed rates the swap credits `50.000000` USDx. The returned transaction log includes `id`, `reference`, `type`, `channel`, `description`, `sourceWalletId`, `destinationWalletId`, both currencies and amounts, `rate`, `sourceRateId`, `destinationRateId`, `fxMetadata`, and `createdAt`.

Send cNGN to Bob's cGHS wallet with a transfer quote:

```bash
curl -s http://localhost:3000/v1/rates/quotes \
  -H "Authorization: Bearer $ALICE_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"fromWalletId\":\"$ALICE_NGN\",\"toWalletId\":\"$BOB_GHS\",\"amount\":\"10000.000000\"}"
TRANSFER_QUOTE_ID='<data.quoteId>'
curl -s http://localhost:3000/v1/transfers \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: alice-bob-0001' \
  -d "{\"fromWalletId\":\"$ALICE_NGN\",\"toWalletId\":\"$BOB_GHS\",\"amount\":\"10000.000000\",\"quoteId\":\"$TRANSFER_QUOTE_ID\"}"
```

Fixed rates credit Bob with `100.000000` cGHS. Send to the recipient's wallet in the same currency to transfer without conversion (no quote needed). Transfers to your own wallets are rejected; use a swap.

Inspect wallets, rates, history and a transaction:

```bash
curl -s http://localhost:3000/v1/wallets -H "Authorization: Bearer $BOB_TOKEN"
curl -s http://localhost:3000/v1/rates
curl -s "http://localhost:3000/v1/transactions?type=TRANSFER&currency=cGHS&limit=20" -H "Authorization: Bearer $ALICE_TOKEN"
curl -s 'http://localhost:3000/v1/transactions/<transaction-uuid>' -H "Authorization: Bearer $ALICE_TOKEN"
```

History's `data` contains `items`, `hasMore`, and `nextCursor`. Pass `nextCursor` as `cursor` to obtain the next page with the same filters. Default limit is 20, maximum 100. Ordering is `(createdAt DESC, id DESC)`. `walletId` limits history to one of your wallets; `currency` matches either side. Direction is `SENT`, `RECEIVED`, or `INTERNAL` (swaps).

Errors: `401` missing/invalid/expired session or invalid credentials; `400` invalid input/key/JSON/cursor or missing quote; `404` absent or inaccessible resource; `409` duplicate identity/wallets/key conflict or expired/mismatched quote; `413` oversized body; `422` invalid financial action, insufficient funds, overflow, or dust; `429` throttled; `503` unavailable rates/database/Redis or exhausted transient retries.

**Funding through virtual bank accounts**

Every wallet gets a virtual bank account (VBA). Creating a wallet inserts the wallet and a `PENDING` VBA row in one transaction, then queues a BullMQ job (`virtualBankAccounts` queue on the existing Redis). `VirtualBankAccountConsumer` asks the bank provider for an account in the user's name (`BorderFlow / <first name> <last name>`) and marks the VBA `ACTIVE` with its account number, name and bank. Failed attempts retry with exponential backoff (`VBA_PROVISION_ATTEMPTS`, default 5; `VBA_PROVISION_BACKOFF_MS`, default 2000); when retries run out the VBA becomes `FAILED` with `failureReason`. `POST /v1/wallets/:walletId/virtual-bank-account` (no body) re-requests issuance for a `PENDING` or `FAILED` VBA and returns `202`; for an `ACTIVE` one it returns `409`. If Redis is down when a wallet is created, the VBA stays `PENDING` until re-requested.

The sandbox provider `borderflow-sandbox` issues a 10-digit account number at "BorderFlow Sandbox Bank"; a real bank adapter would implement the same `BankProvider` interface. As with bank-collection providers, the bank receives fiat and calls our webhook; the settled amount is credited 1:1 to the pegged stablecoin wallet.

The provider calls `POST /v1/webhooks/virtual-bank-accounts/credits` with `settlementId`, `accountNumber`, `amount` and optional `sessionId`, sender details and narration. It signs the exact body: `X-Webhook-Signature` is the hex HMAC-SHA512 of the raw bytes with `VBA_WEBHOOK_SECRET`. A bad signature returns `401`; without a configured secret the webhook returns `503`.

Each credit posts a `DEPOSIT` transaction log with `channel = VIRTUAL_ACCOUNT`, the `virtual_bank_account_id`, the settlement ID as `external_reference`, and the sender details in `external_metadata`. `external_reference` is unique:

- A redelivered settlement returns `200` with `duplicate: true` and the original transaction.
- The same settlement ID with a different account or amount returns `409`.
- Concurrent redeliveries credit exactly once.

For local testing, `POST /v1/dev-tools/bank-credit-signatures` with `{ "accountNumber", "amount", "sourceAccountName"?, "narration"?, "settlementId"? }` plays the bank: it returns the exact `body` and its `signature` (a new `settlementId` is generated unless you pass one). In Hoppscotch, **Dev tools → Sign a bank credit webhook** saves them as `vba_webhook_body` and `vba_webhook_signature`, and the webhook request sends that body verbatim. Dev tools return `404` when `NODE_ENV=production`. Signing by hand also works:

```bash
BODY='{"settlementId":"STL-0001","accountNumber":"9012345678","amount":"50000.00"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha512 -hmac "$VBA_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -s http://localhost:3000/v1/webhooks/virtual-bank-accounts/credits \
  -H 'Content-Type: application/json' -H "X-Webhook-Signature: $SIG" -d "$BODY"
```

**Assumptions and limits**

- This is an authenticated assessment sandbox with simulated funding. Email/phone verification, password recovery, MFA, and admin roles are not implemented. Real funding needs a real provider adapter and custody/operational controls.
- Rates are indicative daily observations. A rates GET is informational; authenticated quotes lock the execution price until their expiry. A seven-day maximum observation age allows weekends and provider outages in this sandbox.
- No fees, spreads, gas, withdrawals, real tokens, refunds, or frontend are implemented.
- Background work (VBA issuance) uses BullMQ on the existing Redis, so no extra service is needed. Rate limiting is process-local. One shared `SYSTEM` wallet per currency simplifies accounting but serializes deposits and conversions in that currency under contention. One API instance is the intended Compose deployment; with several instances each runs the cron job, which only appends duplicate rate rows.
- With more time: verified identities, minimum-receive controls, real funding adapters, reversals, periodic reconciliation, scoped database roles, distributed cron locking, and an outbox for notifications.

**Hoppscotch**

Import the Hoppscotch exports below. Select `BorderFlow Local`, set `base_url`, `email`, and a local secret `password`; edit the name and phone in the signup body for each new user, then send signup or login. Their post-request scripts save `access_token`, `refresh_token`, and one variable per wallet (`cngn_wallet_id`, `cghs_wallet_id`, `cxaf_wallet_id`, `usdx_wallet_id`, `eurx_wallet_id`; empty until wallets are opened). Wallet-scoped requests default to `cngn_wallet_id`; "Open a wallet" saves `<currency>_wallet_id`, and fetching one wallet saves `vba_account_number` once its account is `ACTIVE`. Logout clears tokens and wallet IDs. Failed auth responses do not overwrite saved credentials.

Native exports remain available at [docs/hoppscotch-collection.json](docs/hoppscotch-collection.json) and [docs/hoppscotch-environment.json](docs/hoppscotch-environment.json). No real credentials are included. For transfers, set `recipient_wallet_id` to another user's wallet. Use a new `idempotency_key` for each new operation and retain it only for identical retries.
