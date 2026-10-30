import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { UserSession } from './userSession.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryColumn({
    name: 'token_hash',
    type: 'text',
    primaryKeyConstraintName: 'pk_refresh_tokens',
  })
  tokenHash!: string;
  @Index('idx_refresh_tokens_session_id')
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    precision: 3,
    default: () => 'clock_timestamp()',
  })
  createdAt!: Date;

  @ManyToOne(() => UserSession, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'session_id',
    foreignKeyConstraintName: 'fk_refresh_tokens_session_id',
  })
  session?: UserSession;
}
