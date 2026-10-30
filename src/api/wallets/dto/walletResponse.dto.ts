import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Currency,
  VirtualBankAccountStatus,
} from '@core/common/money/currency';

export class VirtualBankAccountResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) walletId!: string;
  @ApiProperty({ example: 'borderflow-sandbox' }) provider!: string;
  @ApiProperty({
    enum: VirtualBankAccountStatus,
    description: 'PENDING until the background job issues the details',
  })
  status!: VirtualBankAccountStatus;
  @ApiProperty({ type: String, nullable: true, example: '9012345678' })
  accountNumber!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'BorderFlow / Ada Okafor',
  })
  accountName!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'BorderFlow Sandbox Bank',
  })
  bankName!: string | null;
  @ApiProperty({ type: String, nullable: true }) failureReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class WalletResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: Currency }) currency!: Currency;
  @ApiProperty({ example: '150000.000000' }) balance!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: VirtualBankAccountResponseDto, nullable: true })
  virtualBankAccount!: VirtualBankAccountResponseDto | null;
}

export class FxMetadataDto {
  @ApiPropertyOptional({ format: 'uuid' }) quoteId?: string;
  @ApiPropertyOptional({ format: 'date-time' }) quoteExpiresAt?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: '`rates` row used for the source currency',
  })
  sourceRateId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: '`rates` row used for the destination currency',
  })
  destinationRateId?: string;
  @ApiProperty({ enum: ['LIVE', 'STALE_CACHE', 'FIXED', 'FIXED_FALLBACK'] })
  source!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() stale!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) observedDate!:
    string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  refreshedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  configuredAt!: string | null;
}

export class WalletListResponseDto {
  @ApiProperty({ type: [WalletResponseDto] }) wallets!: WalletResponseDto[];
  @ApiProperty({ example: '150.000000' }) totalUsd!: string;
  @ApiProperty({ type: FxMetadataDto }) valuation!: FxMetadataDto;
}
