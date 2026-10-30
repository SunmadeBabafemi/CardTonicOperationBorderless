import { Public } from '@shared/decorators';
import { Controller, Get } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { ErrorResponse, ResponseObject } from '@core/common/helpers/response';
import { RedisCacheService } from '../redis/redis.service';
import { ApiSuccess } from '@core/common/openapi/apiResponse';

class HealthResponseDto {
  @ApiProperty({ enum: ['up', 'ready'] }) status!: string;
  @ApiPropertyOptional({ enum: ['up'] }) database?: string;
  @ApiPropertyOptional({ enum: ['up'] }) redis?: string;
}

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DataSource,
    private readonly cache: RedisCacheService,
  ) {}

  @Get('live')
  @ApiSuccess(HealthResponseDto)
  live() {
    return ResponseObject.Ok({ status: 'up' });
  }

  @Get('ready')
  @ApiSuccess(HealthResponseDto)
  async ready() {
    try {
      await this.database.query('SELECT 1 FROM wallets LIMIT 1');
    } catch {
      ErrorResponse('Database is unavailable', 503);
    }
    await this.cache.ping();
    return ResponseObject.Ok({
      status: 'ready',
      database: 'up',
      redis: 'up',
    });
  }
}
