import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_sessions')
// Partial index (revoked_at IS NULL) owned by the migration.
@Index('idx_user_sessions_expires_at', { synchronize: false })
export class UserSession {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_user_sessions',
  })
  id!: string;
  @Index('idx_user_sessions_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    precision: 3,
    default: () => 'clock_timestamp()',
  })
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_user_sessions_user_id',
  })
  user?: User;
}
