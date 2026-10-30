import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CURRENCIES, sqlList } from '@core/common/money/currency';

/**
 * Complete BorderFlow schema.
 *
 *   users 1─* user_sessions 1─* refresh_tokens
 *   users 1─* wallets            one USER wallet per currency holds the money
 *   wallets 1─* wallet_ledgers   every credit/debit with balance before/after
 *   transaction_logs 1─* wallet_ledgers
 *   transaction_logs *─1 rates   the two rates used by a conversion
 *   wallets 1─1 virtual_bank_accounts → funds the wallet (DEPOSIT, channel VIRTUAL_ACCOUNT);
 *     created PENDING with the wallet, issued by a background job (ACTIVE) or FAILED
 *
 * One SYSTEM wallet per currency (user_id NULL) is the counterparty of every
 * deposit and conversion, so each transaction's ledger entries net to zero per
 * currency. Rates are refreshed by a cron job; FIXED rows are the fallback.
 *
 * Conventions: snake_case plural tables, text + named CHECK enums,
 * pk_/fk_/uq_/chk_/idx_ names. Rates, transaction logs and wallet ledgers are
 * append-only; foreign keys on money tables never cascade.
 */
export class InitialSchema1793316825869 implements MigrationInterface {
  name = 'InitialSchema1793316825869';

  async up(queryRunner: QueryRunner): Promise<void> {
    const currencies = sqlList(CURRENCIES);
    await queryRunner.query(`
      CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = clock_timestamp();
        RETURN NEW;
      END $$;

      CREATE FUNCTION reject_financial_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Committed financial records are immutable' USING ERRCODE = '23514';
      END $$;

      CREATE TABLE users (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        first_name text NOT NULL,
        last_name text NOT NULL,
        email text,
        phone text NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT pk_users PRIMARY KEY (id),
        CONSTRAINT uq_users_email UNIQUE (email),
        CONSTRAINT uq_users_phone UNIQUE (phone),
        CONSTRAINT chk_users_first_name CHECK (first_name = trim(first_name) AND length(first_name) BETWEEN 1 AND 100),
        CONSTRAINT chk_users_last_name CHECK (last_name = trim(last_name) AND length(last_name) BETWEEN 1 AND 100),
        CONSTRAINT chk_users_email_normalized CHECK (email IS NULL OR (email = lower(trim(email)) AND length(email) > 0)),
        CONSTRAINT chk_users_phone_e164 CHECK (phone ~ '^\\+[1-9][0-9]{6,14}$')
      );
      CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE TABLE user_sessions (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT pk_user_sessions PRIMARY KEY (id),
        CONSTRAINT fk_user_sessions_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at) WHERE revoked_at IS NULL;

      CREATE TABLE refresh_tokens (
        token_hash text NOT NULL,
        session_id uuid NOT NULL,
        used_at timestamptz,
        created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT pk_refresh_tokens PRIMARY KEY (token_hash),
        CONSTRAINT fk_refresh_tokens_session_id FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_refresh_tokens_session_id ON refresh_tokens(session_id);

      CREATE TABLE wallets (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        user_id uuid,
        currency text NOT NULL,
        kind text NOT NULL,
        balance numeric(30,6) NOT NULL DEFAULT 0,
        created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT pk_wallets PRIMARY KEY (id),
        CONSTRAINT fk_wallets_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT uq_wallets_user_id_currency UNIQUE (user_id, currency),
        CONSTRAINT chk_wallets_currency CHECK (currency IN (${currencies})),
        CONSTRAINT chk_wallets_kind CHECK (kind IN ('USER', 'SYSTEM')),
        CONSTRAINT chk_wallets_owner CHECK (
          (kind = 'USER' AND user_id IS NOT NULL AND balance >= 0)
          OR (kind = 'SYSTEM' AND user_id IS NULL)
        ),
        CONSTRAINT chk_wallets_balance_finite CHECK (balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric))
      );
      CREATE UNIQUE INDEX uq_wallets_system_currency ON wallets(currency) WHERE kind = 'SYSTEM';
      CREATE TRIGGER trg_wallets_updated_at BEFORE UPDATE ON wallets
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE TABLE rates (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        currency text NOT NULL,
        units_per_usd numeric(38,18) NOT NULL,
        source text NOT NULL,
        provider text NOT NULL,
        observed_date date,
        fetched_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT pk_rates PRIMARY KEY (id),
        CONSTRAINT chk_rates_currency CHECK (currency IN (${currencies})),
        CONSTRAINT chk_rates_source CHECK (source IN ('LIVE', 'FIXED')),
        CONSTRAINT chk_rates_units_per_usd CHECK (units_per_usd > 0 AND units_per_usd < 'Infinity'::numeric),
        CONSTRAINT chk_rates_usd_base CHECK (currency <> 'USDx' OR (units_per_usd = 1 AND observed_date IS NULL))
      );
      CREATE INDEX idx_rates_currency_source_fetched_at ON rates(currency, source, fetched_at);

      CREATE TABLE virtual_bank_accounts (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        wallet_id uuid NOT NULL,
        provider text NOT NULL,
        account_number text,
        account_name text,
        bank_name text,
        status text NOT NULL DEFAULT 'PENDING',
        failure_reason text,
        created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT pk_virtual_bank_accounts PRIMARY KEY (id),
        CONSTRAINT fk_virtual_bank_accounts_wallet_id FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
        CONSTRAINT uq_virtual_bank_accounts_wallet_id UNIQUE (wallet_id),
        CONSTRAINT uq_virtual_bank_accounts_provider_account_number UNIQUE (provider, account_number),
        CONSTRAINT chk_virtual_bank_accounts_account_number CHECK (account_number ~ '^[0-9]{10}$'),
        CONSTRAINT chk_virtual_bank_accounts_status CHECK (status IN ('PENDING', 'ACTIVE', 'FAILED', 'INACTIVE')),
        CONSTRAINT chk_virtual_bank_accounts_issued CHECK (
          status IN ('PENDING', 'FAILED')
          OR (account_number IS NOT NULL AND account_name IS NOT NULL AND bank_name IS NOT NULL)
        )
      );
      CREATE TRIGGER trg_virtual_bank_accounts_updated_at BEFORE UPDATE ON virtual_bank_accounts
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

      CREATE TABLE transaction_logs (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        reference text NOT NULL,
        type text NOT NULL,
        channel text NOT NULL,
        description text NOT NULL,
        initiated_by_user_id uuid,
        idempotency_key text,
        request_hash text,
        source_wallet_id uuid,
        destination_wallet_id uuid NOT NULL,
        source_currency text NOT NULL,
        destination_currency text NOT NULL,
        source_amount numeric(30,6) NOT NULL,
        destination_amount numeric(30,6) NOT NULL,
        rate numeric(38,18) NOT NULL,
        source_rate_id uuid,
        destination_rate_id uuid,
        fx_metadata jsonb,
        virtual_bank_account_id uuid,
        external_reference text,
        external_metadata jsonb,
        created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT pk_transaction_logs PRIMARY KEY (id),
        CONSTRAINT uq_transaction_logs_reference UNIQUE (reference),
        CONSTRAINT uq_transaction_logs_initiated_by_user_id_idempotency_key UNIQUE (initiated_by_user_id, idempotency_key),
        CONSTRAINT uq_transaction_logs_external_reference UNIQUE (external_reference),
        CONSTRAINT fk_transaction_logs_initiated_by_user_id FOREIGN KEY (initiated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_transaction_logs_source_wallet_id FOREIGN KEY (source_wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
        CONSTRAINT fk_transaction_logs_destination_wallet_id FOREIGN KEY (destination_wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
        CONSTRAINT fk_transaction_logs_source_rate_id FOREIGN KEY (source_rate_id) REFERENCES rates(id) ON DELETE RESTRICT,
        CONSTRAINT fk_transaction_logs_destination_rate_id FOREIGN KEY (destination_rate_id) REFERENCES rates(id) ON DELETE RESTRICT,
        CONSTRAINT fk_transaction_logs_virtual_bank_account_id FOREIGN KEY (virtual_bank_account_id) REFERENCES virtual_bank_accounts(id) ON DELETE RESTRICT,
        CONSTRAINT chk_transaction_logs_type CHECK (type IN ('DEPOSIT', 'SWAP', 'TRANSFER')),
        CONSTRAINT chk_transaction_logs_channel CHECK (channel IN ('API', 'VIRTUAL_ACCOUNT')),
        CONSTRAINT chk_transaction_logs_origin CHECK (
          (channel = 'API' AND initiated_by_user_id IS NOT NULL AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL
            AND virtual_bank_account_id IS NULL AND external_reference IS NULL)
          OR (channel = 'VIRTUAL_ACCOUNT' AND type = 'DEPOSIT' AND initiated_by_user_id IS NULL AND idempotency_key IS NULL
            AND request_hash IS NULL AND virtual_bank_account_id IS NOT NULL AND external_reference IS NOT NULL)
        ),
        CONSTRAINT chk_transaction_logs_idempotency_key CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
        CONSTRAINT chk_transaction_logs_source_currency CHECK (source_currency IN (${currencies})),
        CONSTRAINT chk_transaction_logs_destination_currency CHECK (destination_currency IN (${currencies})),
        CONSTRAINT chk_transaction_logs_source_amount CHECK (source_amount > 0 AND source_amount < 'Infinity'::numeric),
        CONSTRAINT chk_transaction_logs_destination_amount CHECK (destination_amount > 0 AND destination_amount < 'Infinity'::numeric),
        CONSTRAINT chk_transaction_logs_rate CHECK (rate > 0 AND rate < 'Infinity'::numeric),
        CONSTRAINT chk_transaction_logs_shape CHECK (
          (type = 'DEPOSIT' AND source_wallet_id IS NULL AND source_currency = destination_currency)
          OR (type = 'SWAP' AND source_wallet_id IS NOT NULL AND source_wallet_id <> destination_wallet_id AND source_currency <> destination_currency)
          OR (type = 'TRANSFER' AND source_wallet_id IS NOT NULL AND source_wallet_id <> destination_wallet_id)
        ),
        CONSTRAINT chk_transaction_logs_rates CHECK (
          source_currency = destination_currency OR (source_rate_id IS NOT NULL AND destination_rate_id IS NOT NULL)
        )
      );
      CREATE INDEX idx_transaction_logs_source_wallet_id_created_at ON transaction_logs(source_wallet_id, created_at DESC, id DESC)
        WHERE source_wallet_id IS NOT NULL;
      CREATE INDEX idx_transaction_logs_destination_wallet_id_created_at ON transaction_logs(destination_wallet_id, created_at DESC, id DESC);
      CREATE INDEX idx_transaction_logs_source_rate_id ON transaction_logs(source_rate_id) WHERE source_rate_id IS NOT NULL;
      CREATE INDEX idx_transaction_logs_destination_rate_id ON transaction_logs(destination_rate_id) WHERE destination_rate_id IS NOT NULL;
      CREATE INDEX idx_transaction_logs_virtual_bank_account_id ON transaction_logs(virtual_bank_account_id)
        WHERE virtual_bank_account_id IS NOT NULL;

      CREATE TABLE wallet_ledgers (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        transaction_log_id uuid NOT NULL,
        wallet_id uuid NOT NULL,
        entry_type text NOT NULL,
        amount numeric(30,6) NOT NULL,
        balance_before numeric(30,6) NOT NULL,
        balance_after numeric(30,6) NOT NULL,
        sequence integer NOT NULL,
        created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT pk_wallet_ledgers PRIMARY KEY (id),
        CONSTRAINT fk_wallet_ledgers_transaction_log_id FOREIGN KEY (transaction_log_id) REFERENCES transaction_logs(id) ON DELETE RESTRICT,
        CONSTRAINT fk_wallet_ledgers_wallet_id FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
        CONSTRAINT uq_wallet_ledgers_transaction_log_id_sequence UNIQUE (transaction_log_id, sequence),
        CONSTRAINT chk_wallet_ledgers_entry_type CHECK (entry_type IN ('CREDIT', 'DEBIT')),
        CONSTRAINT chk_wallet_ledgers_sequence CHECK (sequence > 0),
        CONSTRAINT chk_wallet_ledgers_amount CHECK (amount > 0 AND amount < 'Infinity'::numeric),
        CONSTRAINT chk_wallet_ledgers_running_balance CHECK (
          balance_after = balance_before + CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END
        )
      );
      CREATE INDEX idx_wallet_ledgers_wallet_id_created_at ON wallet_ledgers(wallet_id, created_at);

      CREATE TRIGGER trg_rates_immutable BEFORE UPDATE OR DELETE ON rates
        FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();
      CREATE TRIGGER trg_transaction_logs_immutable BEFORE UPDATE OR DELETE ON transaction_logs
        FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();
      CREATE TRIGGER trg_wallet_ledgers_immutable BEFORE UPDATE OR DELETE ON wallet_ledgers
        FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();

      CREATE FUNCTION assert_balanced_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM wallet_ledgers WHERE transaction_log_id = NEW.id)
          OR EXISTS (
            SELECT w.currency FROM wallet_ledgers l JOIN wallets w ON w.id = l.wallet_id
            WHERE l.transaction_log_id = NEW.id GROUP BY w.currency
            HAVING sum(CASE WHEN l.entry_type = 'CREDIT' THEN l.amount ELSE -l.amount END) <> 0
          ) THEN
          RAISE EXCEPTION 'Unbalanced financial transaction' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;
      CREATE CONSTRAINT TRIGGER trg_transaction_logs_balanced AFTER INSERT ON transaction_logs
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_balanced_transaction();
    `);

    for (const currency of CURRENCIES) {
      await queryRunner.query(
        'INSERT INTO wallets(currency, kind) VALUES ($1, $2)',
        [currency, 'SYSTEM'],
      );
    }
    // Sandbox fixed rate table: the fallback when the live provider fails.
    const fixedRates: Record<string, string> = {
      cNGN: '1000',
      cGHS: '10',
      cXAF: '600',
      USDx: '1',
      EURx: '0.9',
    };
    for (const currency of CURRENCIES) {
      await queryRunner.query(
        'INSERT INTO rates(currency, units_per_usd, source, provider) VALUES ($1, $2, $3, $4)',
        [currency, fixedRates[currency], 'FIXED', 'sandbox-v1'],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE wallet_ledgers;
      DROP TABLE transaction_logs;
      DROP TABLE virtual_bank_accounts;
      DROP TABLE rates;
      DROP TABLE wallets;
      DROP TABLE refresh_tokens;
      DROP TABLE user_sessions;
      DROP TABLE users;
      DROP FUNCTION assert_balanced_transaction();
      DROP FUNCTION reject_financial_mutation();
      DROP FUNCTION set_updated_at();
    `);
  }
}
