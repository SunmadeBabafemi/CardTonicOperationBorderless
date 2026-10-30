import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import {
  Currency,
  CURRENCIES,
  sqlList,
  WalletKind,
} from '@core/common/money/currency';
import { User } from './user.entity';
import type { WalletLedger } from './walletLedger.entity';
import type { VirtualBankAccount } from './virtualBankAccount.entity';

/** Holds the money: one USER wallet per user per currency, one SYSTEM wallet per currency. */
@Entity('wallets')
@Unique('uq_wallets_user_id_currency', ['userId', 'currency'])
// Partial unique index: one SYSTEM wallet per currency.
@Index('uq_wallets_system_currency', { synchronize: false })
@Check('chk_wallets_currency', `currency IN (${sqlList(CURRENCIES)})`)
@Check('chk_wallets_kind', "kind IN ('USER', 'SYSTEM')")
@Check(
  'chk_wallets_owner',
  "(kind = 'USER' AND user_id IS NOT NULL AND balance >= 0) OR (kind = 'SYSTEM' AND user_id IS NULL)",
)
@Check(
  'chk_wallets_balance_finite',
  "balance NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)",
)
export class Wallet {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_wallets' })
  id!: string;
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId!:
    string | null;
  @Column({ type: 'text' }) currency!: Currency;
  @Column({ type: 'text', select: false }) kind!: WalletKind;
  @Column({ type: 'numeric', precision: 30, scale: 6, default: '0' })
  balance!: string;
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    precision: 3,
    default: () => 'clock_timestamp()',
  })
  createdAt!: Date;
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    precision: 3,
    default: () => 'clock_timestamp()',
  })
  updatedAt!: Date;

  @ManyToOne(() => User, (user) => user.wallets, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_wallets_user_id',
  })
  user?: User | null;
  @OneToMany('WalletLedger', (entry: WalletLedger) => entry.wallet)
  ledgers?: WalletLedger[];
  @OneToOne(
    'VirtualBankAccount',
    (account: VirtualBankAccount) => account.wallet,
  )
  virtualBankAccount?: VirtualBankAccount | null;
}
