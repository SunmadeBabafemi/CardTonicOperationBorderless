import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { VirtualBankAccountStatus } from '@core/common/money/currency';
import { Wallet } from './wallet.entity';

/** Bank account details that fund one wallet. */
@Entity('virtual_bank_accounts')
@Unique('uq_virtual_bank_accounts_provider_account_number', [
  'provider',
  'accountNumber',
])
@Unique('uq_virtual_bank_accounts_wallet_id', ['walletId'])
@Check(
  'chk_virtual_bank_accounts_account_number',
  "account_number ~ '^[0-9]{10}$'",
)
@Check(
  'chk_virtual_bank_accounts_status',
  "status IN ('PENDING', 'ACTIVE', 'FAILED', 'INACTIVE')",
)
@Check(
  'chk_virtual_bank_accounts_issued',
  "status IN ('PENDING', 'FAILED') OR (account_number IS NOT NULL AND account_name IS NOT NULL AND bank_name IS NOT NULL)",
)
export class VirtualBankAccount {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_virtual_bank_accounts',
  })
  id!: string;
  @Column({ name: 'wallet_id', type: 'uuid' }) walletId!: string;
  @Column({ type: 'text' }) provider!: string;
  @Column({ name: 'account_number', type: 'text', nullable: true })
  accountNumber!: string | null;
  @Column({ name: 'account_name', type: 'text', nullable: true })
  accountName!: string | null;
  @Column({ name: 'bank_name', type: 'text', nullable: true })
  bankName!: string | null;
  @Column({ type: 'text', default: VirtualBankAccountStatus.PENDING })
  status!: VirtualBankAccountStatus;
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;
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

  @OneToOne(() => Wallet, (wallet) => wallet.virtualBankAccount, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'wallet_id',
    foreignKeyConstraintName: 'fk_virtual_bank_accounts_wallet_id',
  })
  wallet?: Wallet;
}
