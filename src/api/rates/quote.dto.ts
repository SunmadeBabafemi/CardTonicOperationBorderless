import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';
import { Currency } from '@core/common/money/currency';
import { AMOUNT_PATTERN } from '@core/common/money/money';
import { FxMetadataDto } from '@api/wallets/dto/walletResponse.dto';

import { QuoteType } from '@core/modules/fx/fxQuote.types';

export class QuoteDto {
  @ApiProperty({ format: 'uuid', description: 'Your wallet to debit' })
  @IsUUID()
  fromWalletId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Your other wallet (priced as a SWAP) or a recipient wallet (TRANSFER)',
  })
  @IsUUID()
  toWalletId!: string;

  @ApiProperty({
    type: String,
    pattern: AMOUNT_PATTERN.source,
    example: '50000.000000',
  })
  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount!: string;
}

export class QuoteResponseDto extends FxMetadataDto {
  @ApiProperty({ format: 'uuid' }) quoteId!: string;
  @ApiProperty({ enum: QuoteType }) type!: QuoteType;
  @ApiProperty({ format: 'uuid' }) fromWalletId!: string;
  @ApiProperty({ format: 'uuid' }) toWalletId!: string;
  @ApiProperty({ enum: Currency }) fromCurrency!: Currency;
  @ApiProperty({ enum: Currency }) toCurrency!: Currency;
  @ApiProperty({ example: '50000.000000' }) sourceAmount!: string;
  @ApiProperty({ example: '50.000000' }) destinationAmount!: string;
  @ApiProperty({ example: '0.001000000000000000' }) rate!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
