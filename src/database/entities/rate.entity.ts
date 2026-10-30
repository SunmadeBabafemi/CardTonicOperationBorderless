import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  Currency,
  CURRENCIES,
  RateSource,
  sqlList,
} from '@core/common/money/currency';

/** Units of a currency per 1 USD, one row per currency per refresh. Append-only. */
@Entity('rates')
@Index('idx_rates_currency_source_fetched_at', [
  'currency',
  'source',
  'fetchedAt',
])
@Check('chk_rates_currency', `currency IN (${sqlList(CURRENCIES)})`)
@Check('chk_rates_source', "source IN ('LIVE', 'FIXED')")
@Check(
  'chk_rates_units_per_usd',
  "units_per_usd > 0 AND units_per_usd < 'Infinity'::numeric",
)
@Check(
  'chk_rates_usd_base',
  "currency <> 'USDx' OR (units_per_usd = 1 AND observed_date IS NULL)",
)
export class Rate {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_rates' })
  id!: string;
  @Column({ type: 'text' }) currency!: Currency;
  @Column({
    name: 'units_per_usd',
    type: 'numeric',
    precision: 38,
    scale: 18,
  })
  unitsPerUsd!: string;
  @Column({ type: 'text' }) source!: RateSource;
  @Column({ type: 'text' }) provider!: string;
  @Column({ name: 'observed_date', type: 'date', nullable: true })
  observedDate!: string | null;
  @Column({
    name: 'fetched_at',
    type: 'timestamptz',
    precision: 3,
    default: () => 'clock_timestamp()',
  })
  fetchedAt!: Date;
}
