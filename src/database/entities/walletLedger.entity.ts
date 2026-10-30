import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { LedgerEntryType } from '@core/common/money/currency';
import { Wallet } from './wallet.entity';
import { TransactionLog } from './transactionLog.entity';

/** One money movement in or out of a wallet, linked to its transaction log. Append-only. */
@Entity('wallet_ledgers')
@Unique('uq_wallet_ledgers_transaction_log_id_sequence', [
  'transactionLogId',
  'sequence',
])
@Index('idx_wallet_ledgers_wallet_id_created_at', ['walletId', 'createdAt'])
@Check('chk_wallet_ledgers_entry_type', "entry_type IN ('CREDIT', 'DEBIT')")
@Check('chk_wallet_ledgers_sequence', 'sequence > 0')
@Check(
  'chk_wallet_ledgers_amount',
  "amount > 0 AND amount < 'Infinity'::numeric",
)
@Check(
  'chk_wallet_ledgers_running_balance',
  "balance_after = balance_before + CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END",
)
export class WalletLedger {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_wallet_ledgers',
  })
  id!: string;
  @Column({ name: 'transaction_log_id', type: 'uuid' })
  transactionLogId!: string;
  @Column({ name: 'wallet_id', type: 'uuid' }) walletId!: string;
  @Column({ name: 'entry_type', type: 'text' }) entryType!: LedgerEntryType;
  @Column({ type: 'numeric', precision: 30, scale: 6 }) amount!: string;
  @Column({ name: 'balance_before', type: 'numeric', precision: 30, scale: 6 })
  balanceBefore!: string;
  @Column({ name: 'balance_after', type: 'numeric', precision: 30, scale: 6 })
  balanceAfter!: string;
  @Column({ type: 'int' }) sequence!: number;
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    precision: 3,
    default: () => 'clock_timestamp()',
  })
  createdAt!: Date;

  @ManyToOne(() => TransactionLog, (log) => log.ledgers, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'transaction_log_id',
    foreignKeyConstraintName: 'fk_wallet_ledgers_transaction_log_id',
  })
  transactionLog?: TransactionLog;
  @ManyToOne(() => Wallet, (wallet) => wallet.ledgers, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'wallet_id',
    foreignKeyConstraintName: 'fk_wallet_ledgers_wallet_id',
  })
  wallet?: Wallet;
}
