import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import {
  Currency,
  CURRENCIES,
  sqlList,
  TransactionChannel,
  TransactionType,
} from '@core/common/money/currency';
import { User } from './user.entity';
import { Wallet } from './wallet.entity';
import { Rate } from './rate.entity';
import { VirtualBankAccount } from './virtualBankAccount.entity';
import type { WalletLedger } from './walletLedger.entity';

/** One row per deposit, swap or transfer; its wallet ledger entries record the money movement. */
@Entity('transaction_logs')
@Unique('uq_transaction_logs_reference', ['reference'])
@Unique('uq_transaction_logs_initiated_by_user_id_idempotency_key', [
  'initiatedByUserId',
  'idempotencyKey',
])
@Unique('uq_transaction_logs_external_reference', ['externalReference'])
// History (wallet, created_at DESC, id DESC) and partial FK indexes are owned
// by the migration; TypeORM cannot express their shape.
@Index('idx_transaction_logs_source_wallet_id_created_at', {
  synchronize: false,
})
@Index('idx_transaction_logs_destination_wallet_id_created_at', {
  synchronize: false,
})
@Index('idx_transaction_logs_source_rate_id', { synchronize: false })
@Index('idx_transaction_logs_destination_rate_id', { synchronize: false })
@Index('idx_transaction_logs_virtual_bank_account_id', { synchronize: false })
@Check('chk_transaction_logs_type', "type IN ('DEPOSIT', 'SWAP', 'TRANSFER')")
@Check('chk_transaction_logs_channel', "channel IN ('API', 'VIRTUAL_ACCOUNT')")
@Check(
  'chk_transaction_logs_origin',
  "(channel = 'API' AND initiated_by_user_id IS NOT NULL AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL AND virtual_bank_account_id IS NULL AND external_reference IS NULL) OR (channel = 'VIRTUAL_ACCOUNT' AND type = 'DEPOSIT' AND initiated_by_user_id IS NULL AND idempotency_key IS NULL AND request_hash IS NULL AND virtual_bank_account_id IS NOT NULL AND external_reference IS NOT NULL)",
)
@Check(
  'chk_transaction_logs_idempotency_key',
  "idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'",
)
@Check(
  'chk_transaction_logs_source_currency',
  `source_currency IN (${sqlList(CURRENCIES)})`,
)
@Check(
  'chk_transaction_logs_destination_currency',
  `destination_currency IN (${sqlList(CURRENCIES)})`,
)
@Check(
  'chk_transaction_logs_source_amount',
  "source_amount > 0 AND source_amount < 'Infinity'::numeric",
)
@Check(
  'chk_transaction_logs_destination_amount',
  "destination_amount > 0 AND destination_amount < 'Infinity'::numeric",
)
@Check('chk_transaction_logs_rate', "rate > 0 AND rate < 'Infinity'::numeric")
@Check(
  'chk_transaction_logs_shape',
  "(type = 'DEPOSIT' AND source_wallet_id IS NULL AND source_currency = destination_currency) OR (type = 'SWAP' AND source_wallet_id IS NOT NULL AND source_wallet_id <> destination_wallet_id AND source_currency <> destination_currency) OR (type = 'TRANSFER' AND source_wallet_id IS NOT NULL AND source_wallet_id <> destination_wallet_id)",
)
@Check(
  'chk_transaction_logs_rates',
  'source_currency = destination_currency OR (source_rate_id IS NOT NULL AND destination_rate_id IS NOT NULL)',
)
export class TransactionLog {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_transaction_logs',
  })
  id!: string;
  @Column({ type: 'text' }) reference!: string;
  @Column({ type: 'text' }) type!: TransactionType;
  @Column({ type: 'text' }) channel!: TransactionChannel;
  @Column({ type: 'text' }) description!: string;
  @Column({
    name: 'initiated_by_user_id',
    type: 'uuid',
    nullable: true,
    select: false,
  })
  initiatedByUserId!: string | null;
  @Column({
    name: 'idempotency_key',
    type: 'text',
    nullable: true,
    select: false,
  })
  idempotencyKey!: string | null;
  @Column({ name: 'request_hash', type: 'text', nullable: true, select: false })
  requestHash!: string | null;
  @Column({ name: 'source_wallet_id', type: 'uuid', nullable: true })
  sourceWalletId!: string | null;
  @Column({ name: 'destination_wallet_id', type: 'uuid' })
  destinationWalletId!: string;
  @Column({ name: 'source_currency', type: 'text' }) sourceCurrency!: Currency;
  @Column({ name: 'destination_currency', type: 'text' })
  destinationCurrency!: Currency;
  @Column({ name: 'source_amount', type: 'numeric', precision: 30, scale: 6 })
  sourceAmount!: string;
  @Column({
    name: 'destination_amount',
    type: 'numeric',
    precision: 30,
    scale: 6,
  })
  destinationAmount!: string;
  @Column({ type: 'numeric', precision: 38, scale: 18 }) rate!: string;
  @Column({ name: 'source_rate_id', type: 'uuid', nullable: true })
  sourceRateId!: string | null;
  @Column({ name: 'destination_rate_id', type: 'uuid', nullable: true })
  destinationRateId!: string | null;
  @Column({ name: 'fx_metadata', type: 'jsonb', nullable: true })
  fxMetadata!: Record<string, unknown> | null;
  @Column({ name: 'virtual_bank_account_id', type: 'uuid', nullable: true })
  virtualBankAccountId!: string | null;
  @Column({ name: 'external_reference', type: 'text', nullable: true })
  externalReference!: string | null;
  @Column({ name: 'external_metadata', type: 'jsonb', nullable: true })
  externalMetadata!: Record<string, unknown> | null;
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    precision: 3,
    default: () => 'clock_timestamp()',
  })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'initiated_by_user_id',
    foreignKeyConstraintName: 'fk_transaction_logs_initiated_by_user_id',
  })
  initiatedBy?: User | null;
  @ManyToOne(() => Wallet, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'source_wallet_id',
    foreignKeyConstraintName: 'fk_transaction_logs_source_wallet_id',
  })
  sourceWallet?: Wallet | null;
  @ManyToOne(() => Wallet, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'destination_wallet_id',
    foreignKeyConstraintName: 'fk_transaction_logs_destination_wallet_id',
  })
  destinationWallet?: Wallet;
  @ManyToOne(() => Rate, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'source_rate_id',
    foreignKeyConstraintName: 'fk_transaction_logs_source_rate_id',
  })
  sourceRate?: Rate | null;
  @ManyToOne(() => Rate, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'destination_rate_id',
    foreignKeyConstraintName: 'fk_transaction_logs_destination_rate_id',
  })
  destinationRate?: Rate | null;
  @ManyToOne(() => VirtualBankAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'virtual_bank_account_id',
    foreignKeyConstraintName: 'fk_transaction_logs_virtual_bank_account_id',
  })
  virtualBankAccount?: VirtualBankAccount | null;
  @OneToMany('WalletLedger', (entry: WalletLedger) => entry.transactionLog)
  ledgers?: WalletLedger[];
}
