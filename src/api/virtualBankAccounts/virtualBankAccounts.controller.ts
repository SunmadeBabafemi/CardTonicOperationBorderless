import { CurrentUser, Public } from '@shared/decorators';
import type { Principal } from '@core/common/interfaces';
import { OwnershipService } from '@shared/services/ownership.service';
import {
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseObject } from '@core/common/helpers/response';
import { ApiSuccess } from '@core/common/openapi/apiResponse';
import { VirtualBankAccountsService } from './virtualBankAccounts.service';
import {
  BankCreditResponseDto,
  BankCreditWebhookDto,
} from './dto/virtualBankAccount.dto';
import { VirtualBankAccountResponseDto } from '@api/wallets/dto/walletResponse.dto';

@ApiTags('Virtual bank accounts')
@Controller()
export class VirtualBankAccountsController {
  constructor(
    private readonly accounts: VirtualBankAccountsService,
    private readonly ownership: OwnershipService,
  ) {}

  @Post('wallets/:walletId/virtual-bank-account')
  @HttpCode(202)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Request (or retry) issuance of the bank account that funds this wallet; issued in the background',
  })
  @ApiSuccess(VirtualBankAccountResponseDto, 202)
  async request(
    @CurrentUser() user: Principal,
    @Param('walletId', ParseUUIDPipe) walletId: string,
  ) {
    await this.ownership.wallet(walletId, user.userId);
    return ResponseObject.Ok(
      await this.accounts.request(walletId.toLowerCase()),
      'Virtual bank account requested',
      202,
    );
  }

  @Public()
  @Post('webhooks/virtual-bank-accounts/credits')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Provider callback for an inbound bank transfer; credits the wallet once per settlement ID',
  })
  @ApiHeader({
    name: 'X-Webhook-Signature',
    required: true,
    description:
      'Hex HMAC-SHA512 of the raw request body using VBA_WEBHOOK_SECRET',
  })
  @ApiSuccess(BankCreditResponseDto)
  async credit(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-webhook-signature') signature: string | undefined,
    @Body() input: BankCreditWebhookDto,
  ) {
    const result = await this.accounts.credit(
      signature,
      request.rawBody,
      input,
    );
    return ResponseObject.Ok(
      result,
      result.duplicate ? 'Credit already processed' : 'Wallet credited',
    );
  }
}
