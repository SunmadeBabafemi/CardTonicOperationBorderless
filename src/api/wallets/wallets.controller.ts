import { ResponseObject } from '@core/common/helpers/response';
import { CurrentUser } from '@shared/decorators';
import type { Principal } from '@core/common/interfaces';
import { OwnershipService } from '@shared/services/ownership.service';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiIdempotency, ApiSuccess } from '@core/common/openapi/apiResponse';
import { TransactionType } from '@core/common/money/currency';
import { LedgerService } from '@shared/services/ledger.service';
import { TransactionResponseDto } from '@api/transactions/dto/transactionResponse.dto';
import { WalletsService } from './wallets.service';
import { CreateWalletDto, DepositDto, SwapDto } from './dto/movement.dto';
import {
  WalletListResponseDto,
  WalletResponseDto,
} from './dto/walletResponse.dto';

@ApiBearerAuth()
@ApiTags('Wallets')
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly ownership: OwnershipService,
    private readonly wallets: WalletsService,
    private readonly ledger: LedgerService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Open a wallet for one stablecoin; its virtual bank account is issued in the background',
  })
  @ApiSuccess(WalletResponseDto, 201)
  async create(@CurrentUser() user: Principal, @Body() input: CreateWalletDto) {
    return ResponseObject.Ok(
      await this.wallets.create(user.userId, input.currency),
      'Wallet created',
      201,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List your wallets with balances and their total in USD',
  })
  @ApiSuccess(WalletListResponseDto)
  async list(@CurrentUser() user: Principal) {
    return ResponseObject.Ok(await this.wallets.list(user.userId));
  }

  @Get(':walletId')
  @ApiSuccess(WalletResponseDto)
  async find(
    @Param('walletId', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
  ) {
    await this.ownership.wallet(id, user.userId);
    return ResponseObject.Ok(await this.wallets.find(id));
  }

  @Post(':walletId/deposits')
  @ApiOperation({ summary: 'Simulate an immediate deposit into a wallet' })
  @ApiIdempotency()
  @ApiSuccess(TransactionResponseDto, 201)
  async deposit(
    @CurrentUser() user: Principal,
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() input: DepositDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.ownership.wallet(walletId, user.userId);
    const result = await this.ledger.execute(
      {
        type: TransactionType.DEPOSIT,
        fromWalletId: null,
        toWalletId: walletId.toLowerCase(),
        amount: input.amount,
      },
      key,
      user.userId,
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return ResponseObject.Ok(result.data, 'Deposit completed', 201);
  }

  @Post(':walletId/swaps')
  @ApiOperation({
    summary:
      'Swap from this wallet into another of your wallets at a quoted rate',
  })
  @ApiIdempotency()
  @ApiSuccess(TransactionResponseDto, 201)
  async swap(
    @CurrentUser() user: Principal,
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Body() input: SwapDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.ownership.wallet(walletId, user.userId);
    const result = await this.ledger.execute(
      {
        type: TransactionType.SWAP,
        fromWalletId: walletId.toLowerCase(),
        toWalletId: input.toWalletId.toLowerCase(),
        amount: input.amount,
        quoteId: input.quoteId,
      },
      key,
      user.userId,
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return ResponseObject.Ok(result.data, 'Swap completed', 201);
  }
}
