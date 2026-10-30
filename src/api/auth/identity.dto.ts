import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IdentityDto {
  @ApiPropertyOptional({
    example: 'alice@example.com',
    description: 'Optional; can be used to sign in alongside the phone number.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiProperty({
    example: '+2348012345678',
    description: 'International E.164 mobile number.',
  })
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/)
  phone!: string;
}
