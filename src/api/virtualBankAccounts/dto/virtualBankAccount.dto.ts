import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '@core/common/money/money';
import { TransactionResponseDto } from '@api/transactions/dto/transactionResponse.dto';

/** Inbound transfer notice, modelled on bank-provider collection webhooks. */
export class BankCreditWebhookDto {
  @ApiProperty({
    description: 'Provider settlement reference; the idempotency key',
    example: 'STL-202610300001',
  })
  @IsString()
  @Length(1, 128)
  settlementId!: string;

  @ApiPropertyOptional({ example: '000015261030120000123456789012' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string;

  @ApiProperty({ example: '9012345678' })
  @IsString()
  @Matches(/^[0-9]{10}$/)
  accountNumber!: string;

  @ApiProperty({
    type: String,
    example: '50000.00',
    description: 'Settled fiat amount, credited 1:1 to the pegged stablecoin',
    pattern: AMOUNT_PATTERN.source,
  })
  @IsString()
  @Matches(AMOUNT_PATTERN)
  amount!: string;

  @ApiPropertyOptional({ example: 'ADA OKAFOR' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceAccountName?: string;

  @ApiPropertyOptional({ example: '0123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(34)
  sourceAccountNumber?: string;

  @ApiPropertyOptional({ example: 'Example Bank' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceBankName?: string;

  @ApiPropertyOptional({ example: 'Wallet top-up' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  narration?: string;
}

export class BankCreditResponseDto {
  @ApiProperty({
    description: 'True when this settlement was already credited',
  })
  duplicate!: boolean;
  @ApiProperty({ type: TransactionResponseDto })
  transaction!: TransactionResponseDto;
}
