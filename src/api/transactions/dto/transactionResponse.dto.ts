import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Currency,
  TransactionChannel,
  TransactionType,
} from '@core/common/money/currency';
import { FxMetadataDto } from '@api/wallets/dto/walletResponse.dto';

export class TransactionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'TXN-20261030-9F2C4A1B7E3D' }) reference!: string;
  @ApiProperty({ enum: TransactionType }) type!: TransactionType;
  @ApiProperty({ enum: TransactionChannel }) channel!: TransactionChannel;
  @ApiProperty({ example: 'Swap of 1000.000000 cNGN to 1.000000 USDx' })
  description!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  sourceWalletId!: string | null;
  @ApiProperty({ format: 'uuid' }) destinationWalletId!: string;
  @ApiProperty({ enum: Currency }) sourceCurrency!: Currency;
  @ApiProperty({ enum: Currency }) destinationCurrency!: Currency;
  @ApiProperty({ example: '150000.000000' }) sourceAmount!: string;
  @ApiProperty({ example: '150.000000' }) destinationAmount!: string;
  @ApiProperty({ example: '0.001000000000000000' }) rate!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  sourceRateId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  destinationRateId!: string | null;
  @ApiProperty({ type: FxMetadataDto, nullable: true })
  fxMetadata!: FxMetadataDto | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  virtualBankAccountId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Provider settlement ID for virtual bank account credits',
  })
  externalReference!: string | null;
  @ApiProperty({ type: Object, nullable: true })
  externalMetadata!: Record<string, unknown> | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ enum: ['SENT', 'RECEIVED', 'INTERNAL'] })
  direction?: string;
}

export class HistoryResponseDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  items!: TransactionResponseDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
