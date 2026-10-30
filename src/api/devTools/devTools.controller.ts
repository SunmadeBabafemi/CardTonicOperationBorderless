import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseObject } from '@core/common/helpers/response';
import { ApiSuccess } from '@core/common/openapi/apiResponse';
import { Public } from '@shared/decorators';
import { DevToolsService } from './devTools.service';
import {
  SignBankCreditDto,
  SignedWebhookResponseDto,
} from './dto/signBankCredit.dto';

@ApiTags('Dev tools')
@Public()
@Controller('dev-tools')
export class DevToolsController {
  constructor(private readonly devTools: DevToolsService) {}

  @Post('bank-credit-signatures')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign a bank credit webhook (sandbox only)',
    description:
      'Builds the exact webhook body and its X-Webhook-Signature using VBA_WEBHOOK_SECRET. Returns 404 when NODE_ENV=production.',
  })
  @ApiSuccess(SignedWebhookResponseDto)
  signBankCredit(@Body() input: SignBankCreditDto) {
    return ResponseObject.Ok(
      this.devTools.signBankCredit(input),
      'Webhook signed',
    );
  }
}
