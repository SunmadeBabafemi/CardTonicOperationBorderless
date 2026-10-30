import { CurrentUser, Public } from '@shared/decorators';
import type { Principal } from '@core/common/interfaces';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { FxQuoteService } from '@core/modules/fx/fxQuote.service';
import { QuoteDto, QuoteResponseDto } from './quote.dto';
import { ResponseObject } from '@core/common/helpers/response';
import { ApiSuccess } from '@core/common/openapi/apiResponse';
import { Currency } from '@core/common/money/currency';
import { FxService } from '@core/modules/fx/fx.service';
import { FxMetadataDto } from '@api/wallets/dto/walletResponse.dto';

class RateDto extends FxMetadataDto {
  @ApiProperty({ enum: Currency }) fromCurrency!: Currency;
  @ApiProperty({ enum: Currency }) toCurrency!: Currency;
  @ApiProperty({ example: '0.001000000000000000' }) rate!: string;
}
class RatesResponseDto extends FxMetadataDto {
  @ApiProperty({ type: [RateDto] }) rates!: RateDto[];
}

@ApiTags('Rates')
@Controller('rates')
export class RatesController {
  constructor(
    private readonly fx: FxService,
    private readonly quotes: FxQuoteService,
  ) {}

  @Get()
  @Public()
  @ApiSuccess(RatesResponseDto)
  async rates() {
    return ResponseObject.Ok(await this.fx.rates());
  }

  @Post('quotes')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Preview and lock a rate in Redis before a swap or transfer',
  })
  @ApiSuccess(QuoteResponseDto)
  async quote(@CurrentUser() user: Principal, @Body() input: QuoteDto) {
    return ResponseObject.Ok(
      await this.quotes.create(user.userId, input),
      'Rate quote created',
    );
  }
}
