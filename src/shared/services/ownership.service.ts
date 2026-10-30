import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Wallet } from '@database/entities/wallet.entity';
import { TransactionLog } from '@database/entities/transactionLog.entity';

@Injectable()
export class OwnershipService {
  constructor(private readonly database: DataSource) {}
  async wallet(walletId: string, userId: string): Promise<void> {
    try {
      if (
        !(await this.database
          .getRepository(Wallet)
          .existsBy({ id: walletId, userId }))
      )
        ErrorResponse('Wallet was not found', 404);
    } catch (error) {
      catchBlockResponse(error);
    }
  }
  async transaction(transactionId: string, userId: string): Promise<void> {
    try {
      const allowed = await this.database
        .getRepository(TransactionLog)
        .createQueryBuilder('t')
        .innerJoin(
          Wallet,
          'w',
          '(w.id = t.source_wallet_id OR w.id = t.destination_wallet_id) AND w.user_id = :userId',
          { userId },
        )
        .where('t.id = :transactionId', { transactionId })
        .getExists();
      if (!allowed) ErrorResponse('Transaction was not found', 404);
    } catch (error) {
      catchBlockResponse(error);
    }
  }
}
