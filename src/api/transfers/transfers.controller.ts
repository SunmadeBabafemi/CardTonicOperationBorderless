import { CurrentUser } from '@shared/decorators';
import type { Principal } from '@core/common/interfaces';
import { OwnershipService } from '@shared/services/ownership.service';
import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ResponseObject } from '@core/common/helpers/response';
import { ApiIdempotency, ApiSuccess } from '@core/common/openapi/apiResponse';
import { TransactionType } from '@core/common/money/currency';
import { LedgerService } from '@shared/services/ledger.service';
import { TransferDto } from '@api/wallets/dto/movement.dto';
import { TransactionResponseDto } from '@api/transactions/dto/transactionResponse.dto';

@ApiBearerAuth()
@ApiTags('Transfers')
@Controller('transfers')
export class TransfersController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly ownership: OwnershipService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Send to another wallet, converting automatically when currencies differ',
  })
  @ApiIdempotency()
  @ApiSuccess(TransactionResponseDto, 201)
  async transfer(
    @CurrentUser() user: Principal,
    @Body() input: TransferDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.ownership.wallet(input.fromWalletId, user.userId);
    const result = await this.ledger.execute(
      {
        type: TransactionType.TRANSFER,
        fromWalletId: input.fromWalletId.toLowerCase(),
        toWalletId: input.toWalletId.toLowerCase(),
        amount: input.amount,
        quoteId: input.quoteId,
      },
      key,
      user.userId,
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return ResponseObject.Ok(result.data, 'Transfer completed', 201);
  }
}
