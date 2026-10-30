import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, TransactionType } from '@core/common/money/currency';

export class HistoryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only this wallet; defaults to all of your wallets.',
  })
  @IsOptional()
  @IsUUID()
  walletId?: string;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({
    enum: Currency,
    description: 'Matches either currency on the transaction.',
  })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({
    description: 'Opaque nextCursor from the previous response.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
