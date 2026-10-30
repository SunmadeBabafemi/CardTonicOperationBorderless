import { CurrentUser } from '@shared/decorators';
import type { Principal } from '@core/common/interfaces';
import { OwnershipService } from '@shared/services/ownership.service';
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseObject } from '@core/common/helpers/response';
import { ApiSuccess } from '@core/common/openapi/apiResponse';
import { TransactionsService } from './transactions.service';
import { HistoryDto } from './dto/history.dto';
import {
  HistoryResponseDto,
  TransactionResponseDto,
} from './dto/transactionResponse.dto';

@ApiBearerAuth()
@ApiTags('Transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly ownership: OwnershipService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Your transaction history, newest first, filterable by wallet, type and currency',
  })
  @ApiSuccess(HistoryResponseDto)
  async history(@CurrentUser() user: Principal, @Query() input: HistoryDto) {
    return ResponseObject.Ok(
      await this.transactions.history(user.userId, input),
    );
  }

  @Get(':transactionId')
  @ApiSuccess(TransactionResponseDto)
  async find(
    @Param('transactionId', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
  ) {
    await this.ownership.transaction(id, user.userId);
    return ResponseObject.Ok(await this.transactions.find(id));
  }
}
