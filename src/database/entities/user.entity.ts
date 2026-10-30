import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { UserSession } from './userSession.entity';
import type { Wallet } from './wallet.entity';

@Entity('users')
@Unique('uq_users_email', ['email'])
@Unique('uq_users_phone', ['phone'])
@Check(
  'chk_users_first_name',
  'first_name = trim(first_name) AND length(first_name) BETWEEN 1 AND 100',
)
@Check(
  'chk_users_last_name',
  'last_name = trim(last_name) AND length(last_name) BETWEEN 1 AND 100',
)
@Check(
  'chk_users_email_normalized',
  'email IS NULL OR (email = lower(trim(email)) AND length(email) > 0)',
)
@Check('chk_users_phone_e164', "phone ~ '^\\+[1-9][0-9]{6,14}$'")
export class User {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_users' })
  id!: string;
  @Column({ name: 'first_name', type: 'text' }) firstName!: string;
  @Column({ name: 'last_name', type: 'text' }) lastName!: string;
  @Column({ type: 'text', nullable: true }) email!: string | null;
  @Column({ type: 'text' }) phone!: string;
  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash!: string;
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

  @OneToMany('UserSession', (session: UserSession) => session.user)
  sessions?: UserSession[];
  @OneToMany('Wallet', (wallet: Wallet) => wallet.user)
  wallets?: Wallet[];
}
