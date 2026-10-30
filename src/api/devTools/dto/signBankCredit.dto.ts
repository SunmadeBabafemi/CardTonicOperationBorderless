import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { AMOUNT_PATTERN } from '@core/common/money/money';

export class SignBankCreditDto {
  @ApiPropertyOptional({
    description:
      'Defaults to a new unique ID, so each signature is a new credit',
    example: 'STL-202610300001',
  })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  settlementId?: string;

  @ApiProperty({ example: '9012345678' })
  @IsString()
  @Matches(/^[0-9]{10}$/)
  accountNumber!: string;

  @ApiProperty({
    type: String,
    example: '50000.00',
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

  @ApiPropertyOptional({ example: 'Wallet top-up' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  narration?: string;
}

export class SignedWebhookResponseDto {
  @ApiProperty({
    description: 'Send this exact string as the raw webhook body',
  })
  body!: string;
  @ApiProperty({ example: 'X-Webhook-Signature' }) header!: string;
  @ApiProperty({ description: 'Hex HMAC-SHA512 of body' }) signature!: string;
  @ApiProperty({ example: 'POST /v1/webhooks/virtual-bank-accounts/credits' })
  target!: string;
}
