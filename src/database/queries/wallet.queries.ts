import type { EntityManager } from 'typeorm';
import type { Currency, WalletKind } from '@core/common/money/currency';

export interface WalletRow {
  id: string;
  user_id: string | null;
  currency: Currency;
  kind: WalletKind;
  balance: string;
}

/** Plain wallet rows (including `kind`) keyed by id; missing ids are absent. */
export async function findWallets(
  manager: EntityManager,
  ids: string[],
): Promise<Map<string, WalletRow>> {
  const rows = await manager.query<WalletRow[]>(
    'SELECT id, user_id, currency, kind, balance FROM wallets WHERE id = ANY($1::uuid[])',
    [ids],
  );
  return new Map(rows.map((row) => [row.id, row]));
}
