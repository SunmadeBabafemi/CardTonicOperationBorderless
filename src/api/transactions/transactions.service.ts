import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { HttpCodesEnum } from '@core/common/enums/httpCodes.enum';
import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';

import { TransactionLog } from '@database/entities/transactionLog.entity';
import { Wallet } from '@database/entities/wallet.entity';
import { HistoryDto } from './dto/history.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly database: DataSource) {}

  async find(id: string) {
    try {
      const transaction = await this.database
        .getRepository(TransactionLog)
        .findOneBy({ id });
      if (!transaction) ErrorResponse('Transaction was not found', 404);
      return transaction;
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  /** Newest-first history across the user's wallets, or one wallet. */
  async history(userId: string, input: HistoryDto) {
    try {
      const owned = new Set(
        (await this.database.getRepository(Wallet).findBy({ userId })).map(
          (wallet) => wallet.id,
        ),
      );
      const walletId = input.walletId?.toLowerCase();
      if (walletId && !owned.has(walletId))
        ErrorResponse('Wallet was not found', 404);
      const scope = walletId ? [walletId] : [...owned];
      if (!scope.length) return { items: [], hasMore: false, nextCursor: null };
      const query = this.database
        .getRepository(TransactionLog)
        .createQueryBuilder('t')
        .where(
          '(t.source_wallet_id IN (:...scope) OR t.destination_wallet_id IN (:...scope))',
          { scope },
        )
        .orderBy('t.created_at', 'DESC')
        .addOrderBy('t.id', 'DESC')
        .take(input.limit + 1);
      if (input.type) query.andWhere('t.type = :type', { type: input.type });
      if (input.currency)
        query.andWhere(
          '(t.source_currency = :currency OR t.destination_currency = :currency)',
          { currency: input.currency },
        );
      if (input.cursor) {
        const cursor = this.decodeCursor(input.cursor);
        query.andWhere('(t.created_at, t.id) < (:date, :id)', cursor);
      }
      const rows = await query.getMany();
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => {
          const sent =
            row.sourceWalletId !== null && owned.has(row.sourceWalletId);
          const received = owned.has(row.destinationWalletId);
          return {
            ...row,
            direction:
              sent && received ? 'INTERNAL' : sent ? 'SENT' : 'RECEIVED',
          };
        }),
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  date: last.createdAt.toISOString(),
                  id: last.id,
                }),
              ).toString('base64url')
            : null,
      };
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  private decodeCursor(encoded: string): { date: string; id: string } {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(encoded))
        ErrorResponse('Invalid request', HttpCodesEnum.HTTP_BAD_REQUEST);
      const decoded: unknown = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      );
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        !('date' in decoded) ||
        !('id' in decoded) ||
        typeof decoded.date !== 'string' ||
        typeof decoded.id !== 'string' ||
        !isUUID(decoded.id) ||
        !Number.isFinite(Date.parse(decoded.date)) ||
        new Date(decoded.date).toISOString() !== decoded.date
      )
        ErrorResponse('Invalid request', HttpCodesEnum.HTTP_BAD_REQUEST);
      return { date: decoded.date, id: decoded.id };
    } catch {
      ErrorResponse('The history cursor is invalid', 400);
    }
  }
}
