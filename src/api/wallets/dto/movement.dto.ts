import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { Currency } from '@core/common/money/currency';
import { AMOUNT_PATTERN } from '@core/common/money/money';

const amountProperty = {
  type: String,
  example: '150000.000000',
  pattern: AMOUNT_PATTERN.source,
};

export class CreateWalletDto {
  @ApiProperty({ enum: Currency, example: Currency.CNGN })
  @IsEnum(Currency)
  currency!: Currency;
}

export class DepositDto {
  @ApiProperty(amountProperty)
  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount!: string;
}

export class SwapDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Your wallet in the currency to receive',
  })
  @IsUUID()
  toWalletId!: string;

  @ApiProperty(amountProperty)
  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'From POST /v1/rates/quotes for the same wallets and amount.',
  })
  @IsUUID()
  quoteId!: string;
}

export class TransferDto {
  @ApiProperty({ format: 'uuid', description: 'Your wallet to debit' })
  @IsUUID()
  fromWalletId!: string;

  @ApiProperty({ format: 'uuid', description: "The recipient's wallet" })
  @IsUUID()
  toWalletId!: string;

  @ApiProperty(amountProperty)
  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Required when the wallets hold different currencies. Obtain from POST /v1/rates/quotes.',
  })
  @IsOptional()
  @IsUUID()
  quoteId?: string;
}
