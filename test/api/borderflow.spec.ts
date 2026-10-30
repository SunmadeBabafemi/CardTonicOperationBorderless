import 'reflect-metadata';
import { createHash, createHmac, randomUUID, scrypt } from 'node:crypto';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { RedisCacheService } from '@core/modules/redis/redis.service';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '@core/bootstrap';
import { CURRENCIES, Currency, FIAT } from '@core/common/money/currency';
import { FxProvider } from '@core/modules/fx/fx.provider';
import { FxService } from '@core/modules/fx/fx.service';
import type { FxQuotes } from '@core/modules/fx/fx.types';
import { validateEnv } from '@core/core.env';
import {
  BankProvider,
  IssueAccountInput,
  SandboxBankProvider,
} from '@api/virtualBankAccounts/bankProvider';
import { TransactionLog } from '@database/entities/transactionLog.entity';

const fixedRates = { USD: '1', NGN: '1000', GHS: '10', XAF: '600', EUR: '0.9' };
function quotes(live = false): FxQuotes {
  return Object.fromEntries(
    Object.entries(fixedRates).map(([currency, rate]) => [
      currency,
      {
        rate,
        observedDate:
          currency === 'USD' || !live
            ? null
            : new Date().toISOString().slice(0, 10),
      },
    ]),
  ) as FxQuotes;
}

interface Account {
  token: string;
  wallets: Record<Currency, string>;
}

describe('BorderFlow financial API against PostgreSQL', () => {
  let app: INestApplication;
  let database: DataSource;
  let config: ConfigService;
  let redis: Redis;
  const provider = { fetchQuotes: jest.fn<Promise<FxQuotes>, []>() };
  const sandboxBank = new SandboxBankProvider();
  const bank = {
    name: sandboxBank.name,
    issueAccount: jest.fn((input: IssueAccountInput) =>
      sandboxBank.issueAccount(input),
    ),
  };
  const settings: Record<string, unknown> = validateEnv({
    ...process.env,
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  });
  const configuration = {
    get: (name: string) => settings[name],
    getOrThrow: (name: string) => {
      if (settings[name] === undefined)
        throw new Error(`Missing test configuration: ${name}`);
      return settings[name];
    },
    set: (name: string, value: unknown) => {
      settings[name] = value;
    },
  };
  /** Test users by user id, and the token that owns each wallet id. */
  const accounts = new Map<string, Account>();
  const walletTokens = new Map<string, string>();
  let currentToken = '';
  const password = 'test-password-very-long';
  const rawApi = () => request(app.getHttpServer());
  const api = () => {
    const withAuth = (method: 'get' | 'post', url: string) => {
      const walletId = /\/wallets\/([^/?]+)/.exec(url)?.[1];
      return rawApi()
        [method](url)
        .set(
          'Authorization',
          `Bearer ${walletTokens.get(walletId ?? '') ?? currentToken}`,
        );
    };
    return {
      get: (url: string) => withAuth('get', url),
      post: (url: string) => withAuth('post', url),
    };
  };
  const key = () => randomUUID();
  /** A complete signup body with a unique Nigerian mobile number. */
  let phoneSequence = 0;
  const person = (fields: Record<string, unknown> = {}) => ({
    firstName: 'Ada',
    lastName: 'Okafor',
    phone: `+23480${String(Date.now() % 1e4).padStart(4, '0')}${String(++phoneSequence % 1e4).padStart(4, '0')}`,
    ...fields,
  });
  /** A user's wallet id for a currency; unknown handles pass through as ids. */
  const w = (user: string, currency = Currency.USDX) =>
    accounts.get(user)?.wallets[currency] ?? user;
  const tokenOf = (user: string) => accounts.get(user)?.token ?? currentToken;

  async function startApp() {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FxProvider)
      .useValue(provider)
      .overrideProvider(BankProvider)
      .useValue(bank)
      .overrideProvider(ConfigService)
      .useValue(configuration)
      .compile();
    app = module.createNestApplication({ logger: false, bodyParser: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    database = app.get(DataSource);
    config = app.get(ConfigService);
  }

  /** Appends one `rates` row per currency, as the rates job does. */
  async function insertRates(
    source: 'LIVE' | 'FIXED',
    providerName: string,
    values: FxQuotes,
    fetchedAt = new Date(),
  ): Promise<Record<Currency, string>> {
    const ids: Partial<Record<Currency, string>> = {};
    for (const currency of CURRENCIES) {
      const quote = values[FIAT[currency]];
      if (!quote) continue;
      const [row] = await database.query<{ id: string }[]>(
        `INSERT INTO rates(currency, units_per_usd, source, provider, observed_date, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          currency,
          quote.rate,
          source,
          providerName,
          quote.observedDate,
          fetchedAt,
        ],
      );
      ids[currency] = row.id;
    }
    return ids as Record<Currency, string>;
  }
  async function clearRateCache() {
    const keys = await redis.keys(
      `${process.env.TEST_REDIS_PREFIX}:fx:rates:*`,
    );
    if (keys.length) await redis.del(...keys);
  }

  beforeAll(async () => {
    const redisUrl = new URL(process.env.TEST_REDIS_URL ?? '');
    if (
      !['127.0.0.1', 'localhost'].includes(redisUrl.hostname) ||
      redisUrl.pathname !== '/15' ||
      redisUrl.search ||
      !process.env.TEST_REDIS_PREFIX?.startsWith('borderflow_test_')
    )
      throw new Error(
        'API tests require isolated local Redis database 15 and a test key prefix',
      );
    redis = new Redis(redisUrl.toString(), {
      lazyConnect: true,
      retryStrategy: () => null,
    });
    redis.on('error', () => {});
    await redis.connect();
    const url = new URL(process.env.TEST_DATABASE_URL ?? '');
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !/^borderflow_test[a-zA-Z0-9_]*$/.test(url.pathname.slice(1)) ||
      url.search
    ) {
      throw new Error(
        'API tests require an explicitly isolated local borderflow_test database',
      );
    }
    process.env.DATABASE_URL = url.toString();
    const cleanup = new DataSource({ type: 'postgres', url: url.toString() });
    await cleanup.initialize();
    try {
      // TypeORM dropDatabase removes tables but leaves PostgreSQL trigger functions.
      // Recreate only the explicitly guarded test database's public schema.
      await cleanup.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    } finally {
      await cleanup.destroy();
    }
    await startApp();
  });

  beforeEach(async () => {
    provider.fetchQuotes
      .mockReset()
      .mockRejectedValue(new Error('Simulated provider outage'));
    currentToken = '';
    accounts.clear();
    walletTokens.clear();
    const cachedKeys = await redis.keys(`${process.env.TEST_REDIS_PREFIX}:*`);
    if (cachedKeys.length) await redis.del(...cachedKeys);
    config.set('AUTH_RATE_LIMIT_PER_MINUTE', 1000);
    config.set('FX_MODE', 'fixed');
    config.set('FX_REFRESH_SECONDS', 3600);
    config.set('VBA_PROVISION_ATTEMPTS', 2);
    config.set('VBA_PROVISION_BACKOFF_MS', 20);
    bank.issueAccount
      .mockReset()
      .mockImplementation((input) => sandboxBank.issueAccount(input));
    await database.query(
      'TRUNCATE wallet_ledgers, transaction_logs, virtual_bank_accounts, wallets, rates, refresh_tokens, user_sessions, users CASCADE',
    );
    for (const currency of CURRENCIES) {
      await database.query(
        'INSERT INTO wallets(currency, kind) VALUES ($1, $2)',
        [currency, 'SYSTEM'],
      );
    }
    await insertRates('FIXED', 'sandbox-v1', quotes());
  });

  afterEach(async () => {
    if (!database) return;
    const signed =
      "CASE WHEN l.entry_type = 'CREDIT' THEN l.amount ELSE -l.amount END";
    const imbalances =
      await database.query(`SELECT l.transaction_log_id, w.currency
      FROM wallet_ledgers l JOIN wallets w ON w.id = l.wallet_id
      GROUP BY l.transaction_log_id, w.currency HAVING sum(${signed}) <> 0`);
    expect(imbalances).toEqual([]);
    const drift = await database.query(`SELECT w.id FROM wallets w
      LEFT JOIN wallet_ledgers l ON l.wallet_id = w.id GROUP BY w.id
      HAVING w.balance <> coalesce(sum(${signed}), 0)`);
    expect(drift).toEqual([]);
    expect(
      await database.query(
        "SELECT id FROM wallets WHERE kind = 'USER' AND balance < 0",
      ),
    ).toEqual([]);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (redis) {
      const cachedKeys = await redis.keys(`${process.env.TEST_REDIS_PREFIX}:*`);
      if (cachedKeys.length) await redis.del(...cachedKeys);
      redis.disconnect();
    }
  });

  /** Registers a user, opens a wallet per currency and returns the user id. */
  async function wallet(email = `${key()}@example.com`): Promise<string> {
    const response = await api()
      .post('/v1/auth/register')
      .send(person({ email, password }))
      .expect(201);
    const { accessToken, user } = response.body.data;
    expect(user.wallets).toEqual([]);
    currentToken = accessToken;
    const wallets = {} as Record<Currency, string>;
    for (const currency of CURRENCIES) {
      const created = await rawApi()
        .post('/v1/wallets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currency })
        .expect(201);
      wallets[currency] = created.body.data.id;
    }
    accounts.set(user.id, { token: accessToken, wallets });
    for (const id of Object.values(wallets)) walletTokens.set(id, accessToken);
    return user.id as string;
  }
  function deposit(
    user: string,
    amount: string,
    currency = Currency.USDX,
    idempotencyKey = key(),
  ) {
    return rawApi()
      .post(`/v1/wallets/${w(user, currency)}/deposits`)
      .set('Authorization', `Bearer ${tokenOf(user)}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount });
  }
  function swap(
    user: string,
    fromCurrency: Currency,
    toCurrency: Currency,
    amount: string,
    quoteId: string | undefined,
    idempotencyKey = key(),
  ) {
    return rawApi()
      .post(`/v1/wallets/${w(user, fromCurrency)}/swaps`)
      .set('Authorization', `Bearer ${tokenOf(user)}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        toWalletId: w(user, toCurrency),
        amount,
        ...(quoteId ? { quoteId } : {}),
      });
  }
  function transfer(
    from: string,
    to: string,
    amount: string,
    fromCurrency = Currency.USDX,
    toCurrency = Currency.USDX,
    idempotencyKey = key(),
    quoteId?: string,
  ) {
    return rawApi()
      .post('/v1/transfers')
      .set('Authorization', `Bearer ${tokenOf(from)}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        fromWalletId: w(from, fromCurrency),
        toWalletId: w(to, toCurrency),
        amount,
        ...(quoteId ? { quoteId } : {}),
      });
  }
  async function quote(
    from: string,
    fromCurrency: Currency,
    toCurrency: Currency,
    amount: string,
    to?: string,
  ) {
    const response = await rawApi()
      .post('/v1/rates/quotes')
      .set('Authorization', `Bearer ${tokenOf(from)}`)
      .send({
        fromWalletId: w(from, fromCurrency),
        toWalletId: w(to ?? from, toCurrency),
        amount,
      })
      .expect(200);
    return response.body.data;
  }
  function history(user: string, query: Record<string, unknown> = {}) {
    return rawApi()
      .get('/v1/transactions')
      .set('Authorization', `Bearer ${tokenOf(user)}`)
      .query(query);
  }
  async function balance(
    user: string,
    currency = Currency.USDX,
  ): Promise<string> {
    const response = await rawApi()
      .get('/v1/wallets')
      .set('Authorization', `Bearer ${tokenOf(user)}`)
      .expect(200);
    return response.body.data.wallets.find(
      (item: { currency: string }) => item.currency === currency,
    ).balance as string;
  }

  it('starts with migrated schema, health endpoints, and the documented API surface', async () => {
    await api().get('/health/live').expect(200);
    await api().get('/health/ready').expect(200);
    const docs = await api().get('/openapi.json').expect(200);
    expect(docs.body.paths['/v1/transfers']).toBeDefined();
    expect(docs.body.paths['/v1/wallets/{walletId}/swaps']).toBeDefined();
    expect(docs.body.paths['/v1/transactions']).toBeDefined();
    expect(
      docs.body.paths['/v1/wallets/{walletId}/virtual-bank-account'],
    ).toBeDefined();
  });

  it('uses the reference response format for success, validation, authorization, missing routes, and infrastructure failures', async () => {
    const success = await rawApi().get('/health/live').expect(200);
    expect(success.body).toEqual({
      status: 200,
      data: { status: 'up' },
      success: true,
      message: '',
    });
    const invalid = await rawApi()
      .post('/v1/auth/register')
      .send({})
      .expect(400);
    expect(invalid.body).toMatchObject({
      status: 'failed',
      error: 'Bad Request',
      success: false,
      errorCode: 400,
    });
    expect(Array.isArray(invalid.body.message)).toBe(true);
    expect(Object.keys(invalid.body).sort()).toEqual([
      'error',
      'errorCode',
      'message',
      'status',
      'success',
    ]);
    const unauthorized = await rawApi().get('/v1/auth/profile').expect(401);
    expect(unauthorized.body).toEqual({
      status: 'failed',
      error: 'Unauthorized',
      success: false,
      message: 'A valid bearer session is required',
      errorCode: 401,
    });
    const missing = await rawApi().get('/not-a-route').expect(404);
    expect(missing.body).toMatchObject({
      status: 'failed',
      error: 'Not Found',
      success: false,
      errorCode: 404,
    });
    expect(missing.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(missing.body).not.toHaveProperty('requestId');
    const query = jest
      .spyOn(database, 'query')
      .mockRejectedValueOnce(new Error('private database connection details'));
    try {
      const unavailable = await rawApi().get('/health/ready').expect(503);
      expect(unavailable.body).toEqual({
        status: 'failed',
        error: 'Service Unavailable',
        success: false,
        message: 'Database is unavailable',
        errorCode: 503,
      });
    } finally {
      query.mockRestore();
    }
  });

  it('registers without wallets, then opens one wallet per currency and rejects duplicate identities', async () => {
    const response = await api()
      .post('/v1/auth/register')
      .send(
        person({
          email: ' Alice@Example.COM ',
          phone: '+2348012345678',
          password,
        }),
      )
      .expect(201);
    expect(response.body.data.user.email).toBe('alice@example.com');
    expect(response.body.data.user).toMatchObject({
      firstName: 'Ada',
      lastName: 'Okafor',
      phone: '+2348012345678',
    });
    expect(response.body.data.user.wallets).toEqual([]);
    expect(
      await database.query("SELECT id FROM wallets WHERE kind = 'USER'"),
    ).toEqual([]);
    currentToken = response.body.data.accessToken;
    const created = await api()
      .post('/v1/wallets')
      .send({ currency: 'cNGN' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      currency: 'cNGN',
      balance: '0.000000',
    });
    expect(created.body.data).not.toHaveProperty('kind');
    expect(created.body.data.virtualBankAccount.walletId).toBe(
      created.body.data.id,
    );
    expect(['PENDING', 'ACTIVE']).toContain(
      created.body.data.virtualBankAccount.status,
    );
    await api().post('/v1/wallets').send({ currency: 'cNGN' }).expect(409);
    await api().post('/v1/wallets').send({ currency: 'BTC' }).expect(400);
    await api().post('/v1/wallets').send({}).expect(400);
    await api().post('/v1/wallets').send({ currency: 'USDx' }).expect(201);
    const listed = await api().get('/v1/wallets').expect(200);
    expect(
      listed.body.data.wallets.map((row: { currency: string }) => row.currency),
    ).toEqual(['cNGN', 'USDx']);
    expect(listed.body.data.totalUsd).toBe('0.000000');
    const profile = await api().get('/v1/auth/profile').expect(200);
    expect(profile.body.data.wallets).toEqual(
      listed.body.data.wallets.map((row: { id: string; currency: string }) => ({
        id: row.id,
        currency: row.currency,
      })),
    );
    await api()
      .post('/v1/auth/register')
      .send(person({ email: 'ALICE@example.com', password }))
      .expect(409);
    await api()
      .post('/v1/auth/register')
      .send(person({ phone: '+2348012345678', password }))
      .expect(409);
  });

  it('registers a phone-only account and rejects missing or malformed identities', async () => {
    await api()
      .post('/v1/auth/register')
      .send(person({ phone: '+2348012345678', password }))
      .expect(201);
    await api().post('/v1/auth/register').send({}).expect(400);
    for (const missing of ['firstName', 'lastName', 'phone']) {
      const body: Record<string, unknown> = person({
        email: `${missing}@example.com`,
        password,
      });
      delete body[missing];
      await api().post('/v1/auth/register').send(body).expect(400);
    }
    await api()
      .post('/v1/auth/register')
      .send(person({ firstName: '   ', password }))
      .expect(400);
    await api()
      .post('/v1/auth/register')
      .send(person({ lastName: 'Okafor2', password }))
      .expect(400);
    const trimmed = await api()
      .post('/v1/auth/register')
      .send(
        person({ firstName: '  Chi  Chi ', lastName: "O'Neil-Eze", password }),
      )
      .expect(201);
    expect(trimmed.body.data.user.firstName).toBe('Chi Chi');
    expect(trimmed.body.data.user.lastName).toBe("O'Neil-Eze");
    await api()
      .post('/v1/auth/register')
      .send(person({ phone: '08012345678', password }))
      .expect(400);
    await api()
      .post('/v1/auth/register')
      .send(person({ email: 'broken', password }))
      .expect(400);
    await api()
      .post('/v1/auth/register')
      .send(person({ email: 'a@example.com', balance: '100', password }))
      .expect(400);
  });

  it('allows only one user and no wallets under simultaneous duplicate registration', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        api()
          .post('/v1/auth/register')
          .send(person({ email: 'same@example.com', password })),
      ),
    );
    expect(responses.filter((row) => row.status === 201)).toHaveLength(1);
    expect(responses.filter((row) => row.status === 409)).toHaveLength(4);
    const [{ count }] = await database.query<{ count: string }[]>(
      "SELECT count(*) FROM wallets WHERE kind = 'USER'",
    );
    expect(count).toBe('0');
    expect(await database.query('SELECT id FROM users')).toHaveLength(1);
  });

  it('authenticates by password, exposes identity, stores only credential hashes, and revokes sessions', async () => {
    const id = await wallet('login@example.com');
    const original = tokenOf(id);
    const profile = await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${original}`)
      .expect(200);
    expect(profile.body.data.id).toBe(id);
    expect(profile.body.data.wallets).toHaveLength(5);
    expect(profile.body.data.email).toBe('login@example.com');
    const [stored] = await database.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [profile.body.data.id],
    );
    expect(stored.password_hash).toMatch(/^\$2b\$12\$/);
    expect(stored.password_hash).not.toContain(password);
    expect(JSON.stringify(profile.body)).not.toContain('password');
    const login = await rawApi()
      .post('/v1/auth/login')
      .send({ identifier: ' LOGIN@EXAMPLE.COM ', password })
      .expect(200);
    expect(login.body.data.user.wallets).toEqual(profile.body.data.wallets);
    expect(login.body.data.accessToken).not.toBe(original);
    expect(JSON.stringify(login.body)).not.toContain('passwordHash');
    const sessions = await database.query(
      'SELECT token_hash FROM refresh_tokens',
    );
    expect(
      sessions.every(
        (row: { token_hash: string }) =>
          row.token_hash !== original &&
          row.token_hash !== login.body.data.accessToken,
      ),
    ).toBe(true);
    for (const identifier of ['login@example.com', 'unknown@example.com']) {
      const failure = await rawApi()
        .post('/v1/auth/login')
        .send({ identifier, password: 'wrong' })
        .expect(401);
      expect(failure.body.message).toBe('Invalid credentials');
    }
    await rawApi()
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${original}`)
      .expect(200);
    await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${original}`)
      .expect(401);
    await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
    await database.query(
      "UPDATE user_sessions SET expires_at = now() - interval '1 second'",
    );
    await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(401);
  });

  it('logs in with a phone identifier and rejects weak passwords and forged ownership', async () => {
    const registered = await rawApi()
      .post('/v1/auth/register')
      .send(person({ phone: '+2348012345678', password }))
      .expect(201);
    const login = await rawApi()
      .post('/v1/auth/login')
      .send({ identifier: '+2348012345678', password })
      .expect(200);
    expect(login.body.data.user.id).toBe(registered.body.data.user.id);
    await rawApi()
      .post('/v1/auth/register')
      .send(person({ email: 'weak@example.com', password: 'short' }))
      .expect(400);
    await rawApi()
      .post('/v1/auth/register')
      .send(
        person({
          email: 'fake@example.com',
          password,
          userId: registered.body.data.user.id,
        }),
      )
      .expect(400);
  });

  it('upgrades existing scrypt accounts to bcrypt after successful login', async () => {
    const salt = '0123456789abcdef0123456789abcdef';
    const derived = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        64,
        { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, value) => (error ? reject(error) : resolve(value)),
      );
    });
    await database.query(
      'INSERT INTO users(first_name, last_name, phone, email, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [
        'Legacy',
        'User',
        '+2348099999999',
        'legacy-login@example.com',
        `scrypt$${salt}$${derived.toString('hex')}`,
      ],
    );
    await rawApi()
      .post('/v1/auth/login')
      .send({ identifier: 'legacy-login@example.com', password: 'wrong' })
      .expect(401);
    await rawApi()
      .post('/v1/auth/login')
      .send({ identifier: 'legacy-login@example.com', password })
      .expect(200);
    const [stored] = await database.query(
      "SELECT password_hash FROM users WHERE email = 'legacy-login@example.com'",
    );
    expect(stored.password_hash).toMatch(/^\$2b\$12\$/);
    await rawApi()
      .post('/v1/auth/login')
      .send({ identifier: 'legacy-login@example.com', password })
      .expect(200);
  });

  it('opens a currency wallet only once for concurrent requests and rejects supplied ownership', async () => {
    const registered = await rawApi()
      .post('/v1/auth/register')
      .send(person({ email: 'wallet@example.com', password }))
      .expect(201);
    const token = registered.body.data.accessToken;
    await rawApi()
      .post('/v1/wallets')
      .set('Authorization', `Bearer ${token}`)
      .send({ currency: 'cNGN', userId: key() })
      .expect(400);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        rawApi()
          .post('/v1/wallets')
          .set('Authorization', `Bearer ${token}`)
          .send({ currency: 'cNGN' }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ]);
    expect(
      await database.query("SELECT id FROM wallets WHERE kind = 'USER'"),
    ).toHaveLength(1);
    expect(
      await database.query('SELECT id FROM virtual_bank_accounts'),
    ).toHaveLength(1);
  });

  it('issues signed, scoped, short-lived JWTs and rejects tampering or invalid claims', async () => {
    const registered = await rawApi()
      .post('/v1/auth/register')
      .send(person({ email: 'jwt@example.com', password }))
      .expect(201);
    const { accessToken, refreshToken, user } = registered.body.data;
    const secret = config.getOrThrow<string>('AUTH_JWT_SECRET');
    const claims = jwt.verify(accessToken, secret, {
      algorithms: ['HS256'],
      issuer: 'borderflow',
      audience: 'borderflow-api',
    }) as jwt.JwtPayload;
    expect(claims.sub).toBe(user.id);
    expect(claims.tokenUse).toBe('access');
    expect(claims.exp! - claims.iat!).toBe(3600);
    expect(new Date(registered.body.data.expiresAt).getTime()).toBe(
      claims.exp! * 1000,
    );
    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{86}$/);
    const expired = { ...claims, exp: Math.floor(Date.now() / 1000) - 1 };
    const withoutExpiry = { ...claims };
    delete withoutExpiry.exp;
    const invalid = [
      jwt.sign(claims, 'a-different-signing-key'),
      jwt.sign(expired, secret),
      jwt.sign({ ...claims, aud: 'another-api' }, secret),
      jwt.sign({ ...claims, iss: 'another-issuer' }, secret),
      jwt.sign({ ...claims, tokenUse: 'refresh' }, secret),
      jwt.sign(withoutExpiry, secret),
      jwt.sign({ ...claims, sid: undefined }, secret),
      jwt.sign(claims, secret, { algorithm: 'HS384' }),
      jwt.sign(claims, '', { algorithm: 'none' }),
      refreshToken,
      `${accessToken.split('.')[0]}.${Buffer.from(JSON.stringify({ ...claims, sub: key() })).toString('base64url')}.${accessToken.split('.')[2]}`,
    ];
    for (const token of invalid)
      await rawApi()
        .get('/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('rotates refresh tokens, stores only their hashes, and revokes the family on reuse', async () => {
    const registered = await rawApi()
      .post('/v1/auth/register')
      .send(person({ email: 'refresh@example.com', password }))
      .expect(201);
    const original = registered.body.data;
    const refresh = await rawApi()
      .post('/v1/auth/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(200);
    const rotated = refresh.body.data;
    expect(rotated.accessToken).not.toBe(original.accessToken);
    expect(rotated.refreshToken).not.toBe(original.refreshToken);
    expect(rotated.refreshExpiresAt).toBe(original.refreshExpiresAt);
    expect(rotated.user.wallets).toEqual([]);
    const stored = await database.query(
      'SELECT token_hash, used_at FROM refresh_tokens',
    );
    expect(stored).toHaveLength(2);
    expect(
      stored.some(
        (r: { token_hash: string; used_at: Date | null }) =>
          r.token_hash ===
            createHash('sha256').update(original.refreshToken).digest('hex') &&
          r.used_at,
      ),
    ).toBe(true);
    expect(
      stored.every((r: { token_hash: string }) =>
        /^[a-f0-9]{64}$/.test(r.token_hash),
      ),
    ).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(original.refreshToken);
    expect(JSON.stringify(stored)).not.toContain(rotated.refreshToken);
    await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${rotated.accessToken}`)
      .expect(200);
    const separate = await rawApi()
      .post('/v1/auth/login')
      .send({ identifier: 'refresh@example.com', password })
      .expect(200);
    await rawApi()
      .post('/v1/auth/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(401);
    for (const token of [original.accessToken, rotated.accessToken])
      await rawApi()
        .get('/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    await rawApi()
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotated.refreshToken })
      .expect(401);
    await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${separate.body.data.accessToken}`)
      .expect(200);
  });

  it('allows refreshing after access expiry and rejects refresh after logout or session expiry', async () => {
    const registered = await rawApi()
      .post('/v1/auth/register')
      .send(person({ email: 'expiry@example.com', password }))
      .expect(201);
    const original = registered.body.data;
    const claims = jwt.decode(original.accessToken) as jwt.JwtPayload;
    const expired = jwt.sign(
      { ...claims, exp: Math.floor(Date.now() / 1000) - 1 },
      config.getOrThrow<string>('AUTH_JWT_SECRET'),
    );
    await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    const refreshed = await rawApi()
      .post('/v1/auth/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(200);
    await rawApi()
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${refreshed.body.data.accessToken}`)
      .expect(200);
    await rawApi()
      .post('/v1/auth/refresh')
      .send({ refreshToken: refreshed.body.data.refreshToken })
      .expect(401);
    await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${original.accessToken}`)
      .expect(401);
    const login = await rawApi()
      .post('/v1/auth/login')
      .send({ identifier: 'expiry@example.com', password })
      .expect(200);
    await database.query(
      "UPDATE user_sessions SET expires_at = now() - interval '1 second'",
    );
    await rawApi()
      .post('/v1/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(401);
    await rawApi()
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'A'.repeat(86) })
      .expect(401);
    await rawApi()
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'invalid' })
      .expect(400);
  });

  it('serializes concurrent refreshes and revokes the family when a token is reused', async () => {
    const registered = await rawApi()
      .post('/v1/auth/register')
      .send(person({ email: 'concurrent-refresh@example.com', password }))
      .expect(201);
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        rawApi()
          .post('/v1/auth/refresh')
          .send({ refreshToken: registered.body.data.refreshToken }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    const success = responses.find((r) => r.status === 200)!;
    await rawApi()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${success.body.data.accessToken}`)
      .expect(401);
    await rawApi()
      .post('/v1/auth/refresh')
      .send({ refreshToken: success.body.data.refreshToken })
      .expect(401);
  });

  it('enforces bcrypt UTF-8 byte limits without silently truncating passwords', async () => {
    for (const long of ['x'.repeat(73), '😀'.repeat(19)])
      await rawApi()
        .post('/v1/auth/register')
        .send(person({ email: 'too-long@example.com', password: long }))
        .expect(400);
    const exact = 'x'.repeat(72);
    await rawApi()
      .post('/v1/auth/register')
      .send(person({ email: 'length@example.com', password: exact }))
      .expect(201);
    await rawApi()
      .post('/v1/auth/login')
      .send({ identifier: 'length@example.com', password: exact + 'x' })
      .expect(401);
    await rawApi()
      .post('/v1/auth/login')
      .send({ identifier: 'length@example.com', password: exact })
      .expect(200);
  });

  it('requires authentication on all private routes and denies cross-user access before idempotent replay', async () => {
    const alice = await wallet();
    const bob = await wallet();
    const outsider = await wallet();
    const aliceWallet = w(alice);
    const keyValue = key();
    const deposited = await deposit(
      alice,
      '100',
      Currency.USDX,
      keyValue,
    ).expect(201);
    const sent = await transfer(alice, bob, '10').expect(201);
    const routes: ['get' | 'post', string][] = [
      ['get', '/v1/wallets'],
      ['get', `/v1/wallets/${aliceWallet}`],
      ['post', `/v1/wallets/${aliceWallet}/deposits`],
      ['post', `/v1/wallets/${aliceWallet}/swaps`],
      ['post', `/v1/wallets/${aliceWallet}/virtual-bank-account`],
      ['post', '/v1/transfers'],
      ['post', '/v1/wallets'],
      ['get', '/v1/transactions'],
      ['get', `/v1/transactions/${sent.body.data.id}`],
      ['post', '/v1/rates/quotes'],
      ['get', '/v1/auth/profile'],
      ['post', '/v1/auth/logout'],
    ];
    for (const [method, url] of routes) {
      await rawApi()[method](url).expect(401);
      await rawApi()
        [method](url)
        .set('Authorization', 'Bearer forged')
        .expect(401);
    }
    for (const path of [
      `/v1/wallets/${aliceWallet}`,
      `/v1/transactions?walletId=${aliceWallet}`,
      `/v1/transactions/${sent.body.data.id}`,
      `/v1/transactions/${deposited.body.data.id}`,
    ]) {
      await rawApi()
        .get(path)
        .set('Authorization', `Bearer ${tokenOf(outsider)}`)
        .expect(404);
    }
    await rawApi()
      .post(`/v1/wallets/${aliceWallet}/virtual-bank-account`)
      .set('Authorization', `Bearer ${tokenOf(outsider)}`)
      .expect(404);
    await rawApi()
      .post(`/v1/wallets/${aliceWallet}/deposits`)
      .set('Authorization', `Bearer ${tokenOf(bob)}`)
      .set('Idempotency-Key', keyValue)
      .send({ amount: '100' })
      .expect(404);
    await rawApi()
      .post(`/v1/wallets/${aliceWallet}/swaps`)
      .set('Authorization', `Bearer ${tokenOf(bob)}`)
      .set('Idempotency-Key', key())
      .send({ toWalletId: w(bob, Currency.EURX), amount: '1', quoteId: key() })
      .expect(404);
    await rawApi()
      .post('/v1/transfers')
      .set('Authorization', `Bearer ${tokenOf(bob)}`)
      .set('Idempotency-Key', key())
      .send({ fromWalletId: aliceWallet, toWalletId: w(bob), amount: '1' })
      .expect(404);
    for (const user of [alice, bob])
      await rawApi()
        .get(`/v1/transactions/${sent.body.data.id}`)
        .set('Authorization', `Bearer ${tokenOf(user)}`)
        .expect(200);
    expect(await balance(alice)).toBe('90.000000');
  });

  it.each(CURRENCIES)(
    'deposits %s immediately into its wallet and records two wallet ledger entries',
    async (currency) => {
      const id = await wallet();
      const response = await deposit(id, '0.100001', currency).expect(201);
      expect(await balance(id, currency)).toBe('0.100001');
      const entries = await database.query(
        `SELECT l.entry_type, l.amount, l.balance_before, l.balance_after, w.kind
         FROM wallet_ledgers l JOIN wallets w ON w.id = l.wallet_id
         WHERE l.transaction_log_id = $1 ORDER BY l.sequence`,
        [response.body.data.id],
      );
      expect(entries).toEqual([
        {
          entry_type: 'DEBIT',
          amount: '0.100001',
          balance_before: '0.000000',
          balance_after: '-0.100001',
          kind: 'SYSTEM',
        },
        {
          entry_type: 'CREDIT',
          amount: '0.100001',
          balance_before: '0.000000',
          balance_after: '0.100001',
          kind: 'USER',
        },
      ]);
      const single = await api()
        .get(`/v1/transactions/${response.body.data.id}`)
        .set('Authorization', `Bearer ${tokenOf(id)}`)
        .expect(200);
      expect(single.body.data.sourceAmount).toBe('0.100001');
      expect(single.body.data.destinationWalletId).toBe(w(id, currency));
      expect(single.body.data.description).toBe(
        `Deposit of 0.100001 ${currency}`,
      );
      expect(single.body.data.reference).toMatch(/^TXN-\d{8}-[0-9A-F]{12}$/);
      expect(single.body.data).not.toHaveProperty('requestHash');
      expect(single.body.data).not.toHaveProperty('idempotencyKey');
      expect(single.body.data).not.toHaveProperty('initiatedByUserId');
    },
  );

  interface VirtualBankAccountView {
    id: string;
    walletId: string;
    status: string;
    accountNumber: string;
    failureReason: string | null;
  }
  /** Waits for the background job to settle a wallet's virtual bank account. */
  async function virtualBankAccount(
    user: string,
    currency = Currency.CNGN,
    until = ['ACTIVE'],
  ): Promise<VirtualBankAccountView> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await rawApi()
        .get(`/v1/wallets/${w(user, currency)}`)
        .set('Authorization', `Bearer ${tokenOf(user)}`)
        .expect(200);
      const account = response.body.data.virtualBankAccount;
      if (account && until.includes(account.status)) return account;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Virtual bank account never reached ${until.join('/')}`);
  }
  function bankCredit(
    payload: Record<string, unknown>,
    secret = process.env.VBA_WEBHOOK_SECRET ?? '',
  ) {
    const body = JSON.stringify(payload);
    return rawApi()
      .post('/v1/webhooks/virtual-bank-accounts/credits')
      .set('Content-Type', 'application/json')
      .set(
        'X-Webhook-Signature',
        createHmac('sha512', secret).update(body).digest('hex'),
      )
      .send(body);
  }

  it('issues every wallet a virtual bank account in the background and attaches it to wallet responses', async () => {
    const alice = await wallet();
    const issued = await Promise.all(
      CURRENCIES.map((currency) => virtualBankAccount(alice, currency)),
    );
    expect(issued.every((row) => /^\d{10}$/.test(row.accountNumber))).toBe(
      true,
    );
    expect(new Set(issued.map((row) => row.accountNumber)).size).toBe(5);
    expect(bank.issueAccount).toHaveBeenCalledTimes(5);
    const listed = await rawApi()
      .get('/v1/wallets')
      .set('Authorization', `Bearer ${tokenOf(alice)}`)
      .expect(200);
    for (const row of listed.body.data.wallets) {
      expect(row.virtualBankAccount.walletId).toBe(row.id);
      expect(row.virtualBankAccount.status).toBe('ACTIVE');
      expect(row.virtualBankAccount.bankName).toBe('BorderFlow Sandbox Bank');
      expect(row.virtualBankAccount.accountName).toBe(
        'BorderFlow / Ada Okafor',
      );
    }
    await rawApi()
      .post(`/v1/wallets/${w(alice, Currency.CNGN)}/virtual-bank-account`)
      .set('Authorization', `Bearer ${tokenOf(alice)}`)
      .expect(409);
    const bob = await wallet();
    await rawApi()
      .post(`/v1/wallets/${w(alice, Currency.CNGN)}/virtual-bank-account`)
      .set('Authorization', `Bearer ${tokenOf(bob)}`)
      .expect(404);
  });

  it('marks a virtual bank account FAILED after retries and issues it when re-requested', async () => {
    bank.issueAccount.mockRejectedValue(new Error('Bank is unavailable'));
    const registered = await rawApi()
      .post('/v1/auth/register')
      .send(person({ email: 'retry@example.com', password }))
      .expect(201);
    const token = registered.body.data.accessToken;
    const created = await rawApi()
      .post('/v1/wallets')
      .set('Authorization', `Bearer ${token}`)
      .send({ currency: 'cNGN' })
      .expect(201);
    const walletId = created.body.data.id as string;
    accounts.set(registered.body.data.user.id, {
      token,
      wallets: { [Currency.CNGN]: walletId } as Record<Currency, string>,
    });
    const user = registered.body.data.user.id as string;
    const failed = await virtualBankAccount(user, Currency.CNGN, ['FAILED']);
    expect(failed.failureReason).toBe('Bank is unavailable');
    expect(bank.issueAccount).toHaveBeenCalledTimes(2);
    bank.issueAccount.mockImplementation((input) =>
      sandboxBank.issueAccount(input),
    );
    const requested = await rawApi()
      .post(`/v1/wallets/${walletId}/virtual-bank-account`)
      .set('Authorization', `Bearer ${token}`)
      .expect(202);
    expect(['PENDING', 'ACTIVE']).toContain(requested.body.data.status);
    const active = await virtualBankAccount(user);
    expect(active.accountNumber).toMatch(/^\d{10}$/);
    expect(active.failureReason).toBeNull();
  });

  it('credits a wallet once per settlement ID from a signed bank webhook', async () => {
    const alice = await wallet();
    const account = await virtualBankAccount(alice);
    const payload = {
      settlementId: `STL-${key()}`,
      sessionId: '000015261030120000123456789012',
      accountNumber: account.accountNumber,
      amount: '50000.00',
      sourceAccountName: 'ADA OKAFOR',
      narration: 'Wallet top-up',
    };
    const credited = await bankCredit(payload).expect(200);
    expect(credited.body.data.duplicate).toBe(false);
    const transaction = credited.body.data.transaction;
    expect(transaction.type).toBe('DEPOSIT');
    expect(transaction.channel).toBe('VIRTUAL_ACCOUNT');
    expect(transaction.destinationAmount).toBe('50000.000000');
    expect(transaction.virtualBankAccountId).toBe(account.id);
    expect(transaction.externalReference).toBe(payload.settlementId);
    expect(transaction.externalMetadata.sourceAccountName).toBe('ADA OKAFOR');
    expect(await balance(alice, Currency.CNGN)).toBe('50000.000000');

    const repeated = await bankCredit(payload).expect(200);
    expect(repeated.body.data.duplicate).toBe(true);
    expect(repeated.body.data.transaction.id).toBe(transaction.id);
    await bankCredit({ ...payload, amount: '1.00' }).expect(409);
    expect(await balance(alice, Currency.CNGN)).toBe('50000.000000');
    const listed = await history(alice).expect(200);
    expect(listed.body.data.items).toHaveLength(1);
    expect(listed.body.data.items[0].direction).toBe('RECEIVED');
  });

  it('credits concurrent redeliveries of one settlement exactly once', async () => {
    const alice = await wallet();
    const { accountNumber } = await virtualBankAccount(alice);
    const payload = {
      settlementId: `STL-${key()}`,
      accountNumber,
      amount: '10',
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () => bankCredit(payload)),
    );
    expect(results.map((row) => row.status)).toEqual([200, 200, 200, 200]);
    expect(results.filter((row) => !row.body.data.duplicate)).toHaveLength(1);
    expect(await balance(alice, Currency.CNGN)).toBe('10.000000');
  });

  it('rejects unsigned, mis-signed and unknown-account bank webhooks', async () => {
    const alice = await wallet();
    const { accountNumber } = await virtualBankAccount(alice);
    const payload = {
      settlementId: `STL-${key()}`,
      accountNumber,
      amount: '10',
    };
    await rawApi()
      .post('/v1/webhooks/virtual-bank-accounts/credits')
      .send(payload)
      .expect(401);
    await bankCredit(payload, 'x'.repeat(64)).expect(401);
    await bankCredit({ ...payload, accountNumber: '0000000000' }).expect(404);
    expect(await balance(alice, Currency.CNGN)).toBe('0.000000');
    expect(await database.getRepository(TransactionLog).count()).toBe(0);
  });

  it('signs a bank credit with dev tools so the exact body credits the wallet once', async () => {
    const alice = await wallet();
    const { accountNumber } = await virtualBankAccount(alice);
    const signed = await rawApi()
      .post('/v1/dev-tools/bank-credit-signatures')
      .send({
        accountNumber,
        amount: '2500.50',
        sourceAccountName: 'ADA OKAFOR',
      })
      .expect(200);
    const { body, header, signature } = signed.body.data;
    expect(header).toBe('X-Webhook-Signature');
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    expect(JSON.parse(body)).toMatchObject({
      accountNumber,
      amount: '2500.50',
    });
    const send = () =>
      rawApi()
        .post('/v1/webhooks/virtual-bank-accounts/credits')
        .set('Content-Type', 'application/json')
        .set(header, signature)
        .send(body);
    expect((await send().expect(200)).body.data.duplicate).toBe(false);
    expect((await send().expect(200)).body.data.duplicate).toBe(true);
    expect(await balance(alice, Currency.CNGN)).toBe('2500.500000');
    const another = await rawApi()
      .post('/v1/dev-tools/bank-credit-signatures')
      .send({ accountNumber, amount: '1' })
      .expect(200);
    expect(JSON.parse(another.body.data.body).settlementId).not.toBe(
      JSON.parse(body).settlementId,
    );
    await rawApi()
      .post('/v1/webhooks/virtual-bank-accounts/credits')
      .set('Content-Type', 'application/json')
      .set(header, signature)
      .send(another.body.data.body)
      .expect(401);
  });

  it('hides dev tools in production', async () => {
    config.set('NODE_ENV', 'production');
    try {
      await rawApi()
        .post('/v1/dev-tools/bank-credit-signatures')
        .send({ accountNumber: '9012345678', amount: '1' })
        .expect(404);
    } finally {
      config.set('NODE_ENV', 'test');
    }
  });

  it.each([0, '0', '-1', '1e3', '0.0000001', 'NaN', '1000000000000001'])(
    'rejects invalid deposit %s without financial records',
    async (amount) => {
      const id = await wallet();
      const response = await rawApi()
        .post(`/v1/wallets/${w(id)}/deposits`)
        .set('Authorization', `Bearer ${tokenOf(id)}`)
        .set('Idempotency-Key', key())
        .send({ amount });
      expect([400, 422]).toContain(response.status);
      expect(await balance(id)).toBe('0.000000');
      expect(await database.getRepository(TransactionLog).count()).toBe(0);
    },
  );

  it('requires idempotency keys and rejects extra fields, malformed UUIDs and unknown wallets', async () => {
    const id = await wallet();
    await rawApi()
      .post(`/v1/wallets/${w(id)}/deposits`)
      .set('Authorization', `Bearer ${tokenOf(id)}`)
      .send({ amount: '1' })
      .expect(400);
    await rawApi()
      .post(`/v1/wallets/${w(id)}/deposits`)
      .set('Authorization', `Bearer ${tokenOf(id)}`)
      .set('Idempotency-Key', key())
      .send({ currency: 'BTC', amount: '1' })
      .expect(400);
    await api().get('/v1/wallets/invalid').expect(400);
    await api().get(`/v1/transactions/${key()}`).expect(404);
    await deposit(key(), '1').expect(404);
  });

  it('returns client errors for malformed JSON and oversized request bodies', async () => {
    const malformed = await api()
      .post('/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{broken')
      .expect(400);
    expect(malformed.body.errorCode).toBe(400);
    const oversized = await api()
      .post('/v1/auth/register')
      .send({ email: 'x'.repeat(17000) })
      .expect(413);
    expect(oversized.body.errorCode).toBe(413);
  });

  it('replays canonical equivalent requests and rejects changed payloads and operations', async () => {
    const id = await wallet();
    const idempotencyKey = key();
    const first = await deposit(id, '1', Currency.USDX, idempotencyKey).expect(
      201,
    );
    const replay = await deposit(
      id,
      '1.000000',
      Currency.USDX,
      idempotencyKey,
    ).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await deposit(id, '2', Currency.USDX, idempotencyKey).expect(409);
    const other = await wallet();
    await transfer(
      id,
      other,
      '1',
      Currency.USDX,
      Currency.USDX,
      idempotencyKey,
    ).expect(409);
    expect(await balance(id)).toBe('1.000000');
  });

  it('commits only once for concurrent duplicate deposits', async () => {
    const id = await wallet();
    const idempotencyKey = key();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        deposit(id, '10', Currency.USDX, idempotencyKey),
      ),
    );
    expect(results.every((row) => row.status === 201)).toBe(true);
    expect(new Set(results.map((row) => row.body.data.id)).size).toBe(1);
    expect(await balance(id)).toBe('10.000000');
    expect(await database.getRepository(TransactionLog).count()).toBe(1);
  });

  it('swaps between two of the user’s wallets with the exact rate and four ledger entries', async () => {
    const id = await wallet();
    await deposit(id, '150000', Currency.CNGN).expect(201);
    const quoted = await quote(id, Currency.CNGN, Currency.USDX, '150000');
    expect(quoted.type).toBe('SWAP');
    const result = await swap(
      id,
      Currency.CNGN,
      Currency.USDX,
      '150000',
      quoted.quoteId,
    ).expect(201);
    expect(result.body.data.destinationAmount).toBe('150.000000');
    expect(result.body.data.rate).toBe('0.001000000000000000');
    expect(result.body.data.sourceRateId).toBe(quoted.sourceRateId);
    expect(result.body.data.destinationRateId).toBe(quoted.destinationRateId);
    expect(result.body.data.fxMetadata.source).toBe('FIXED');
    expect(await balance(id, Currency.CNGN)).toBe('0.000000');
    expect(await balance(id)).toBe('150.000000');
    const entries = await database.query(
      `SELECT l.entry_type, l.amount, w.kind, w.currency FROM wallet_ledgers l
       JOIN wallets w ON w.id = l.wallet_id WHERE l.transaction_log_id = $1 ORDER BY l.sequence`,
      [result.body.data.id],
    );
    expect(entries).toEqual([
      {
        entry_type: 'DEBIT',
        amount: '150000.000000',
        kind: 'USER',
        currency: 'cNGN',
      },
      {
        entry_type: 'CREDIT',
        amount: '150000.000000',
        kind: 'SYSTEM',
        currency: 'cNGN',
      },
      {
        entry_type: 'DEBIT',
        amount: '150.000000',
        kind: 'SYSTEM',
        currency: 'USDx',
      },
      {
        entry_type: 'CREDIT',
        amount: '150.000000',
        kind: 'USER',
        currency: 'USDx',
      },
    ]);
    const listed = await history(id, { type: 'SWAP' }).expect(200);
    expect(listed.body.data.items[0].direction).toBe('INTERNAL');
  });

  it('supports all 20 directed conversion pairs', async () => {
    const id = await wallet();
    for (const currency of CURRENCIES)
      await deposit(id, '1000', currency).expect(201);
    for (const fromCurrency of CURRENCIES)
      for (const toCurrency of CURRENCIES) {
        if (fromCurrency !== toCurrency) {
          const { quoteId } = await quote(id, fromCurrency, toCurrency, '1');
          await swap(id, fromCurrency, toCurrency, '1', quoteId).expect(201);
        }
      }
  });

  it('rejects insufficient funds, swaps into the same wallet, swaps to others, and destination dust', async () => {
    const id = await wallet();
    const other = await wallet();
    const { quoteId } = await quote(id, Currency.USDX, Currency.EURX, '1');
    await swap(id, Currency.USDX, Currency.EURX, '1', quoteId).expect(422);
    await swap(id, Currency.USDX, Currency.USDX, '1', key()).expect(422);
    await rawApi()
      .post(`/v1/wallets/${w(id)}/swaps`)
      .set('Authorization', `Bearer ${tokenOf(id)}`)
      .set('Idempotency-Key', key())
      .send({
        toWalletId: w(other, Currency.EURX),
        amount: '1',
        quoteId: key(),
      })
      .expect(422);
    await deposit(id, '0.000001', Currency.CNGN).expect(201);
    await rawApi()
      .post('/v1/rates/quotes')
      .set('Authorization', `Bearer ${tokenOf(id)}`)
      .send({
        fromWalletId: w(id, Currency.CNGN),
        toWalletId: w(id, Currency.USDX),
        amount: '0.000001',
      })
      .expect(422);
    expect(await balance(id, Currency.CNGN)).toBe('0.000001');
  });

  it('transfers in the same currency with one transaction log in both histories', async () => {
    const alice = await wallet();
    const bob = await wallet();
    await deposit(alice, '100').expect(201);
    const result = await transfer(alice, bob, '20').expect(201);
    expect(await balance(alice)).toBe('80.000000');
    expect(await balance(bob)).toBe('20.000000');
    const sent = await history(alice, { type: 'TRANSFER' }).expect(200);
    const received = await history(bob, { type: 'TRANSFER' }).expect(200);
    expect(sent.body.data.items[0].id).toBe(result.body.data.id);
    expect(received.body.data.items[0].id).toBe(result.body.data.id);
    expect(sent.body.data.items[0].direction).toBe('SENT');
    expect(received.body.data.items[0].direction).toBe('RECEIVED');
    const entries = await database.query(
      `SELECT wallet_id, entry_type, balance_before, balance_after FROM wallet_ledgers
       WHERE transaction_log_id = $1 ORDER BY sequence`,
      [result.body.data.id],
    );
    expect(entries).toEqual([
      {
        wallet_id: w(alice),
        entry_type: 'DEBIT',
        balance_before: '100.000000',
        balance_after: '80.000000',
      },
      {
        wallet_id: w(bob),
        entry_type: 'CREDIT',
        balance_before: '0.000000',
        balance_after: '20.000000',
      },
    ]);
  });

  it('converts directly into the receiver’s wallet in one four-entry transfer', async () => {
    const alice = await wallet();
    const bob = await wallet();
    await deposit(alice, '150000', Currency.CNGN).expect(201);
    const quoted = await quote(
      alice,
      Currency.CNGN,
      Currency.CGHS,
      '150000',
      bob,
    );
    expect(quoted.type).toBe('TRANSFER');
    const response = await transfer(
      alice,
      bob,
      '150000',
      Currency.CNGN,
      Currency.CGHS,
      key(),
      quoted.quoteId,
    ).expect(201);
    expect(response.body.data.destinationAmount).toBe('1500.000000');
    expect(await balance(alice, Currency.CNGN)).toBe('0.000000');
    expect(await balance(alice, Currency.CGHS)).toBe('0.000000');
    expect(await balance(bob, Currency.CGHS)).toBe('1500.000000');
    const [{ count }] = await database.query<{ count: string }[]>(
      'SELECT count(*) FROM wallet_ledgers WHERE transaction_log_id = $1',
      [response.body.data.id],
    );
    expect(count).toBe('4');
  });

  it('rejects self-transfers, transfers between own wallets, missing quotes and absent recipients without partial writes', async () => {
    const alice = await wallet();
    const bob = await wallet();
    await deposit(alice, '100').expect(201);
    await transfer(alice, alice, '10').expect(422);
    await transfer(alice, alice, '10', Currency.USDX, Currency.EURX).expect(
      422,
    );
    await transfer(alice, bob, '10', Currency.USDX, Currency.EURX).expect(400);
    await transfer(alice, key(), '10').expect(404);
    expect(await balance(alice)).toBe('100.000000');
    expect(await database.getRepository(TransactionLog).count()).toBe(1);
  });

  it('prevents simultaneous spending beyond the available balance', async () => {
    const alice = await wallet();
    const bob = await wallet();
    await deposit(alice, '100').expect(201);
    const results = await Promise.all([
      transfer(alice, bob, '80'),
      transfer(alice, bob, '80'),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([201, 422]);
    expect(await balance(alice)).toBe('20.000000');
    expect(await balance(bob)).toBe('80.000000');
  });

  it('does not lose a concurrent deposit and transfer update', async () => {
    const alice = await wallet();
    const bob = await wallet();
    await deposit(alice, '100').expect(201);
    const results = await Promise.all([
      deposit(alice, '50'),
      transfer(alice, bob, '30'),
    ]);
    expect(results.map((row) => row.status)).toEqual([201, 201]);
    expect(await balance(alice)).toBe('120.000000');
    expect(await balance(bob)).toBe('30.000000');
  });

  it('completes opposing simultaneous transfers without lock inversion', async () => {
    const alice = await wallet();
    const bob = await wallet();
    await deposit(alice, '100').expect(201);
    await deposit(bob, '100').expect(201);
    const results = await Promise.all([
      transfer(alice, bob, '40'),
      transfer(bob, alice, '40'),
    ]);
    expect(results.map((row) => row.status)).toEqual([201, 201]);
    expect(await balance(alice)).toBe('100.000000');
    expect(await balance(bob)).toBe('100.000000');
  });

  it('rolls back debit, ledger entries, transaction log, and key if the second leg fails', async () => {
    const alice = await wallet();
    const bob = await wallet();
    await deposit(alice, '100').expect(201);
    const idempotencyKey = key();
    await database.query(`CREATE FUNCTION test_fail_second_leg() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.sequence = 2 THEN RAISE EXCEPTION 'Injected posting failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_fail_second_leg BEFORE INSERT ON wallet_ledgers FOR EACH ROW EXECUTE FUNCTION test_fail_second_leg()`);
    try {
      const failed = await transfer(
        alice,
        bob,
        '30',
        Currency.USDX,
        Currency.USDX,
        idempotencyKey,
      ).expect(500);
      expect(failed.body.errorCode).toBe(500);
      expect(JSON.stringify(failed.body)).not.toContain(
        'Injected posting failure',
      );
      expect(await balance(alice)).toBe('100.000000');
      expect(await balance(bob)).toBe('0.000000');
      expect(await database.getRepository(TransactionLog).count()).toBe(1);
      expect(
        await database.query(
          'SELECT id FROM transaction_logs WHERE idempotency_key = $1',
          [idempotencyKey],
        ),
      ).toEqual([]);
    } finally {
      await database.query(
        'DROP TRIGGER test_fail_second_leg ON wallet_ledgers; DROP FUNCTION test_fail_second_leg()',
      );
    }
    await transfer(
      alice,
      bob,
      '30',
      Currency.USDX,
      Currency.USDX,
      idempotencyKey,
    ).expect(201);
  });

  it('enforces ledger immutability and rejects unbalanced transaction logs at commit', async () => {
    const id = await wallet();
    await deposit(id, '10').expect(201);
    await expect(
      database.query('UPDATE wallet_ledgers SET amount = amount + 1'),
    ).rejects.toThrow('immutable');
    await expect(
      database.query("UPDATE transaction_logs SET description = 'edited'"),
    ).rejects.toThrow('immutable');
    await expect(
      database.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO transaction_logs(reference, type, channel, description, initiated_by_user_id, idempotency_key, request_hash,
             destination_wallet_id, source_currency, destination_currency, source_amount, destination_amount, rate)
           SELECT 'TXN-UNBALANCED', 'DEPOSIT', 'API', 'forged', user_id, 'unbalanced-test', 'hash', id, 'USDx', 'USDx', 1, 1, 1
           FROM wallets WHERE id = $1`,
          [w(id)],
        );
      }),
    ).rejects.toThrow('Unbalanced');
    expect(await balance(id)).toBe('10.000000');
  });

  it('returns deterministic cursor pages and filters by type, currency and wallet', async () => {
    const id = await wallet();
    for (let i = 0; i < 5; i++) await deposit(id, '1').expect(201);
    await deposit(id, '2', Currency.EURX).expect(201);
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await history(id, {
        type: 'DEPOSIT',
        currency: 'USDx',
        limit: 2,
        ...(cursor ? { cursor } : {}),
      }).expect(200);
      found.push(
        ...response.body.data.items.map((item: { id: string }) => item.id),
      );
      cursor = response.body.data.nextCursor as string | null;
    } while (cursor);
    expect(found).toHaveLength(5);
    expect(new Set(found).size).toBe(5);
    const euro = await history(id, { walletId: w(id, Currency.EURX) }).expect(
      200,
    );
    expect(euro.body.data.items).toHaveLength(1);
    expect((await history(id).expect(200)).body.data.items).toHaveLength(6);
    await history(id, { cursor: 'broken' }).expect(400);
    await history(id, { limit: 101 }).expect(400);
    await history(id, { walletId: key() }).expect(404);
  });

  it('lists 25 rates with refresh times and values all wallets in USD', async () => {
    const id = await wallet();
    await deposit(id, '1000', Currency.CNGN).expect(201);
    await deposit(id, '10', Currency.CGHS).expect(201);
    await deposit(id, '600', Currency.CXAF).expect(201);
    await deposit(id, '1', Currency.USDX).expect(201);
    await deposit(id, '0.9', Currency.EURX).expect(201);
    const wallets = await rawApi()
      .get('/v1/wallets')
      .set('Authorization', `Bearer ${tokenOf(id)}`)
      .expect(200);
    expect(wallets.body.data.totalUsd).toBe('5.000000');
    const rates = await api().get('/v1/rates').expect(200);
    expect(rates.body.data.rates).toHaveLength(25);
    expect(rates.body.data.source).toBe('FIXED');
    expect(rates.body.data.observedDate).toBeNull();
    expect(rates.body.data.refreshedAt).toBeNull();
    expect(rates.body.data.configuredAt).not.toBeNull();
    const pair = rates.body.data.rates.find(
      (row: { fromCurrency: string; toCurrency: string }) =>
        row.fromCurrency === 'cNGN' && row.toCurrency === 'USDx',
    );
    expect(pair.rate).toBe('0.001000000000000000');
    expect(pair.sourceRateId).toMatch(/^[0-9a-f-]{36}$/);
    expect(provider.fetchQuotes).not.toHaveBeenCalled();
  });

  it('uses fixed fallback on provider failure and appends successful live rates', async () => {
    config.set('FX_MODE', 'live');
    const fallback = await api().get('/v1/rates').expect(200);
    expect(fallback.body.data.source).toBe('FIXED_FALLBACK');
    await clearRateCache();
    provider.fetchQuotes.mockResolvedValue(quotes(true));
    const fresh = await api().get('/v1/rates').expect(200);
    expect(fresh.body.data.source).toBe('LIVE');
    expect(fresh.body.data.observedDate).toBe(
      new Date().toISOString().slice(0, 10),
    );
    expect(fresh.body.data.refreshedAt).not.toBeNull();
    const cached = await api().get('/v1/rates').expect(200);
    expect(cached.body.data.refreshedAt).toBe(fresh.body.data.refreshedAt);
    expect(provider.fetchQuotes).toHaveBeenCalledTimes(2);
    const [{ count }] = await database.query<{ count: string }[]>(
      "SELECT count(*) FROM rates WHERE source = 'LIVE'",
    );
    expect(count).toBe('5');
  });

  it('refreshes rates from the scheduled job every six hours', async () => {
    const job = app.get(SchedulerRegistry).getCronJob('ratesRefresh');
    expect(job.cronTime.source).toBe('0 */6 * * *');
    config.set('FX_MODE', 'live');
    provider.fetchQuotes.mockResolvedValue(quotes(true));
    await app.get(FxService).refreshNow();
    const rows = await database.query<
      { currency: string; units_per_usd: string }[]
    >(
      "SELECT currency, units_per_usd FROM rates WHERE source = 'LIVE' ORDER BY currency",
    );
    expect(rows.map((row) => row.currency).sort()).toEqual(
      [...CURRENCIES].sort(),
    );
    const rates = await api().get('/v1/rates').expect(200);
    expect(rates.body.data.source).toBe('LIVE');
    expect(provider.fetchQuotes).toHaveBeenCalledTimes(1);
  });

  it('uses recent stored live rates as stale cache after a failed refresh', async () => {
    config.set('FX_MODE', 'live');
    await insertRates(
      'LIVE',
      'frankfurter-v2',
      quotes(true),
      new Date(Date.now() - 7200000),
    );
    const result = await api().get('/v1/rates').expect(200);
    expect(result.body.data.source).toBe('STALE_CACHE');
    expect(result.body.data.stale).toBe(true);
  });

  it('rejects expired or partial provider rates and keeps the fixed rate table', async () => {
    config.set('FX_MODE', 'live');
    const old = quotes(true);
    for (const value of Object.values(old))
      if (value.observedDate) value.observedDate = '2000-01-01';
    await insertRates('LIVE', 'old', old);
    provider.fetchQuotes.mockResolvedValue({
      USD: { rate: '1', observedDate: null },
    } as FxQuotes);
    const result = await api().get('/v1/rates').expect(200);
    expect(result.body.data.source).toBe('FIXED_FALLBACK');
    expect(result.body.data.rates).toHaveLength(25);
  });

  it('shares one external refresh among concurrent requests', async () => {
    config.set('FX_MODE', 'live');
    provider.fetchQuotes.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return quotes(true);
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api().get('/v1/rates')),
    );
    expect(results.every((row) => row.status === 200)).toBe(true);
    expect(new Set(results.map((row) => row.body.data.refreshedAt)).size).toBe(
      1,
    );
    expect(provider.fetchQuotes).toHaveBeenCalledTimes(1);
  });

  it('locks quoted rates for swaps and transfers even after the displayed rate changes', async () => {
    const alice = await wallet();
    const bob = await wallet();
    await deposit(alice, '2000', Currency.CNGN).expect(201);
    const swapQuote = await quote(alice, Currency.CNGN, Currency.USDX, '1000');
    const transferQuote = await quote(
      alice,
      Currency.CNGN,
      Currency.USDX,
      '1000',
      bob,
    );
    expect(swapQuote.rate).toBe('0.001000000000000000');
    expect(swapQuote.destinationAmount).toBe('1.000000');
    expect(transferQuote.sourceRateId).toBe(swapQuote.sourceRateId);
    const quoteKey = `${process.env.TEST_REDIS_PREFIX}:fx:quote:${swapQuote.quoteId}`;
    expect(await redis.exists(quoteKey)).toBe(1);
    expect(await redis.ttl(quoteKey)).toBeGreaterThan(0);
    expect(await redis.ttl(quoteKey)).toBeLessThanOrEqual(300);
    const changed = quotes();
    changed.NGN.rate = '2000';
    await insertRates('FIXED', 'new-fixed', changed, new Date(Date.now() + 10));
    await clearRateCache();
    const changedRates = await api().get('/v1/rates').expect(200);
    expect(
      changedRates.body.data.rates.find(
        (r: { fromCurrency: string; toCurrency: string }) =>
          r.fromCurrency === 'cNGN' && r.toCurrency === 'USDx',
      ).rate,
    ).toBe('0.000500000000000000');
    const select = jest
      .spyOn(app.get(FxService), 'select')
      .mockRejectedValue(
        new Error('Execution must not reprice a cached quote'),
      );
    try {
      const swapped = await swap(
        alice,
        Currency.CNGN,
        Currency.USDX,
        '1000',
        swapQuote.quoteId,
      ).expect(201);
      const sent = await transfer(
        alice,
        bob,
        '1000',
        Currency.CNGN,
        Currency.USDX,
        key(),
        transferQuote.quoteId,
      ).expect(201);
      for (const result of [swapped, sent]) {
        expect(result.body.data.rate).toBe('0.001000000000000000');
        expect(result.body.data.destinationAmount).toBe('1.000000');
        expect(result.body.data.sourceRateId).toBe(swapQuote.sourceRateId);
      }
      expect(swapped.body.data.fxMetadata.quoteId).toBe(swapQuote.quoteId);
      expect(sent.body.data.fxMetadata.quoteId).toBe(transferQuote.quoteId);
      expect(select).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
    expect(await balance(alice, Currency.CNGN)).toBe('0.000000');
    expect(await balance(alice)).toBe('1.000000');
    expect(await balance(bob)).toBe('1.000000');
  });

  it('requires an authenticated quote and rejects mismatched amounts, wallets, operations, and users without posting', async () => {
    const alice = await wallet();
    const bob = await wallet();
    const charlie = await wallet();
    await deposit(alice, '1000', Currency.CNGN).expect(201);
    await rawApi().post('/v1/rates/quotes').send({}).expect(401);
    const swapQuote = await quote(alice, Currency.CNGN, Currency.USDX, '1000');
    await swap(alice, Currency.CNGN, Currency.USDX, '1000', undefined).expect(
      400,
    );
    await swap(
      alice,
      Currency.CNGN,
      Currency.USDX,
      '999',
      swapQuote.quoteId,
    ).expect(409);
    await swap(
      alice,
      Currency.CNGN,
      Currency.CGHS,
      '1000',
      swapQuote.quoteId,
    ).expect(409);
    await rawApi()
      .post(`/v1/wallets/${w(alice, Currency.CNGN)}/swaps`)
      .set('Authorization', `Bearer ${tokenOf(alice)}`)
      .set('Idempotency-Key', key())
      .send({
        toWalletId: w(alice),
        amount: '1000',
        rate: '999',
        quoteId: swapQuote.quoteId,
      })
      .expect(400);
    const bobQuote = await quote(bob, Currency.CNGN, Currency.USDX, '1000');
    await swap(
      alice,
      Currency.CNGN,
      Currency.USDX,
      '1000',
      bobQuote.quoteId,
    ).expect(409);
    const sentQuote = await quote(
      alice,
      Currency.CNGN,
      Currency.USDX,
      '1000',
      bob,
    );
    await transfer(
      alice,
      charlie,
      '1000',
      Currency.CNGN,
      Currency.USDX,
      key(),
      sentQuote.quoteId,
    ).expect(409);
    await transfer(
      alice,
      bob,
      '1000',
      Currency.CNGN,
      Currency.USDX,
      key(),
      swapQuote.quoteId,
    ).expect(409);
    await swap(
      alice,
      Currency.CNGN,
      Currency.USDX,
      '1000',
      sentQuote.quoteId,
    ).expect(409);
    await rawApi()
      .post('/v1/rates/quotes')
      .set('Authorization', `Bearer ${tokenOf(bob)}`)
      .send({
        fromWalletId: w(alice, Currency.CNGN),
        toWalletId: w(bob),
        amount: '1',
      })
      .expect(404);
    expect(await balance(alice, Currency.CNGN)).toBe('1000.000000');
    expect(await database.getRepository(TransactionLog).count()).toBe(1);
  });

  it('rejects an expired, evicted, or malformed cached quote while preserving committed idempotent retries', async () => {
    const id = await wallet();
    await deposit(id, '3000', Currency.CNGN).expect(201);
    const original = await quote(id, Currency.CNGN, Currency.USDX, '1000');
    const idempotencyKey = key();
    const run = (quoteId: string, idempotency = key()) =>
      swap(id, Currency.CNGN, Currency.USDX, '1000', quoteId, idempotency);
    const committed = await run(original.quoteId, idempotencyKey).expect(201);
    await redis.del(
      `${process.env.TEST_REDIS_PREFIX}:fx:quote:${original.quoteId}`,
    );
    const replay = await run(original.quoteId, idempotencyKey).expect(201);
    expect(replay.body).toEqual(committed.body);
    const missing = await run(original.quoteId).expect(409);
    expect(missing.body).toEqual({
      status: 'failed',
      error: 'Conflict Request',
      success: false,
      message: 'The conversion rate has expired. Please request a new rate.',
      errorCode: 409,
    });
    const fresh = await quote(id, Currency.CNGN, Currency.USDX, '1000');
    const cacheKey = `${process.env.TEST_REDIS_PREFIX}:fx:quote:${fresh.quoteId}`;
    const stored = JSON.parse((await redis.get(cacheKey))!);
    await redis.set(
      cacheKey,
      JSON.stringify({
        ...stored,
        expiresAt: new Date(Date.now() - 1).toISOString(),
      }),
      'EX',
      300,
    );
    expect(await redis.exists(cacheKey)).toBe(1);
    const expired = await run(fresh.quoteId).expect(409);
    expect(expired.body.errorCode).toBe(409);
    await redis.set(cacheKey, '{broken', 'EX', 300);
    const malformed = await run(fresh.quoteId).expect(409);
    expect(malformed.body.errorCode).toBe(409);
    expect(await balance(id, Currency.CNGN)).toBe('2000.000000');
  });

  it('rejects a cross-currency transfer with an expired cached rate without fetching a replacement', async () => {
    const alice = await wallet();
    const bob = await wallet();
    await deposit(alice, '2000', Currency.CNGN).expect(201);
    const cached = await quote(
      alice,
      Currency.CNGN,
      Currency.CGHS,
      '1000',
      bob,
    );
    await redis.del(
      `${process.env.TEST_REDIS_PREFIX}:fx:quote:${cached.quoteId}`,
    );
    const select = jest
      .spyOn(app.get(FxService), 'select')
      .mockRejectedValue(new Error('A replacement rate must not be fetched'));
    try {
      const result = await transfer(
        alice,
        bob,
        '1000',
        Currency.CNGN,
        Currency.CGHS,
        key(),
        cached.quoteId,
      ).expect(409);
      expect(result.body).toEqual({
        status: 'failed',
        error: 'Conflict Request',
        success: false,
        message: 'The conversion rate has expired. Please request a new rate.',
        errorCode: 409,
      });
      expect(select).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
    expect(await database.getRepository(TransactionLog).count()).toBe(1);
    expect(await balance(alice, Currency.CNGN)).toBe('2000.000000');
    expect(await balance(bob, Currency.CGHS)).toBe('0.000000');
  });

  it('checks quote expiry again after wallet locks and rolls back an expired operation', async () => {
    const id = await wallet();
    await deposit(id, '1000', Currency.CNGN).expect(201);
    const quoted = await quote(id, Currency.CNGN, Currency.USDX, '1000');
    const cacheKey = `${process.env.TEST_REDIS_PREFIX}:fx:quote:${quoted.quoteId}`;
    const stored = JSON.parse((await redis.get(cacheKey))!);
    await redis.set(
      cacheKey,
      JSON.stringify({
        ...stored,
        expiresAt: new Date(Date.now() + 300).toISOString(),
      }),
      'EX',
      300,
    );
    const runner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let result: request.Response;
    try {
      await runner.query('SELECT id FROM wallets WHERE id = $1 FOR UPDATE', [
        w(id, Currency.CNGN),
      ]);
      const pending = swap(
        id,
        Currency.CNGN,
        Currency.USDX,
        '1000',
        quoted.quoteId,
      ).then((response) => response);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await runner.commitTransaction();
      result = await pending;
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    expect(result!.status).toBe(409);
    expect(result!.body.errorCode).toBe(409);
    expect(await database.getRepository(TransactionLog).count()).toBe(1);
    expect(await balance(id, Currency.CNGN)).toBe('1000.000000');
  });

  it('shares a Redis rate selection between service instances and reloads it after cache expiry', async () => {
    config.set('FX_MODE', 'live');
    provider.fetchQuotes.mockResolvedValue(quotes(true));
    await api().get('/v1/rates').expect(200);
    const cacheKeys = await redis.keys(
      `${process.env.TEST_REDIS_PREFIX}:fx:rates:*`,
    );
    expect(cacheKeys).toHaveLength(1);
    const changed = quotes(true);
    changed.NGN.rate = '2000';
    await insertRates('LIVE', 'newer', changed, new Date(Date.now() + 10));
    const replica = new FxService(
      database,
      config,
      provider,
      app.get(RedisCacheService),
    );
    const pair = async () =>
      (await replica.rates()).rates.find(
        (row) => row.fromCurrency === 'cNGN' && row.toCurrency === 'USDx',
      )!.rate;
    expect(await pair()).toBe('0.001000000000000000');
    await redis.pexpire(cacheKeys[0], 1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await pair()).toBe('0.000500000000000000');
    expect(provider.fetchQuotes).toHaveBeenCalledTimes(1);
  });

  it('fails quoted operations safely during Redis outages while preserving deposits and committed retries', async () => {
    const id = await wallet();
    await deposit(id, '3000', Currency.CNGN).expect(201);
    const quoted = await quote(id, Currency.CNGN, Currency.USDX, '1000');
    const idempotencyKey = key();
    const committed = await swap(
      id,
      Currency.CNGN,
      Currency.USDX,
      '1000',
      quoted.quoteId,
      idempotencyKey,
    ).expect(201);
    app.get(RedisCacheService).onModuleDestroy();
    try {
      const failed = await swap(
        id,
        Currency.CNGN,
        Currency.USDX,
        '1000',
        quoted.quoteId,
      ).expect(503);
      expect(failed.body.errorCode).toBe(503);
      await api().get('/health/ready').expect(503);
      const replay = await swap(
        id,
        Currency.CNGN,
        Currency.USDX,
        '1000',
        quoted.quoteId,
        idempotencyKey,
      ).expect(201);
      expect(replay.body).toEqual(committed.body);
      await deposit(id, '1', Currency.CNGN).expect(201);
      const [source] = await database.query(
        'SELECT balance FROM wallets WHERE id = $1',
        [w(id, Currency.CNGN)],
      );
      expect(source.balance).toBe('2001.000000');
    } finally {
      await app.close();
      await startApp();
    }
  });

  it('limits password attempts and prevents authentication responses from being cached', async () => {
    await app.close();
    config.set('AUTH_RATE_LIMIT_PER_MINUTE', 2);
    await startApp();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await rawApi()
          .post('/v1/auth/login')
          .send({ identifier: 'absent@example.com', password })
          .expect(401);
        expect(response.headers['cache-control']).toBe('no-store');
      }
      const limited = await rawApi()
        .post('/v1/auth/login')
        .send({ identifier: 'absent@example.com', password })
        .expect(429);
      expect(limited.body.errorCode).toBe(429);
    } finally {
      await app.close();
      config.set('AUTH_RATE_LIMIT_PER_MINUTE', 1000);
      await startApp();
    }
  });

  it('replays the original conversion after restart even when rates become unavailable', async () => {
    const id = await wallet();
    await deposit(id, '1000', Currency.CNGN).expect(201);
    const idempotencyKey = key();
    const { quoteId } = await quote(id, Currency.CNGN, Currency.USDX, '1000');
    const original = await swap(
      id,
      Currency.CNGN,
      Currency.USDX,
      '1000',
      quoteId,
      idempotencyKey,
    ).expect(201);
    await app.close();
    await startApp();
    const select = jest
      .spyOn(app.get(FxService), 'select')
      .mockRejectedValue(new Error('No rate available'));
    try {
      const replay = await swap(
        id,
        Currency.CNGN,
        Currency.USDX,
        '1000',
        quoteId,
        idempotencyKey,
      ).expect(201);
      expect(replay.body).toEqual(original.body);
      expect(select).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
    expect(await balance(id)).toBe('1.000000');
  });
});
