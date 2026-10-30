import { Currency } from '@core/common/money/currency';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsByteLength,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IdentityDto } from './identity.dto';

const collapseSpaces = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
/** Letters (any script), spaces, apostrophes, hyphens and periods. */
const NAME_PATTERN = /^\p{L}[\p{L}\p{M} '.-]*$/u;

export class RegisterDto extends IdentityDto {
  @ApiProperty({ example: 'Ada', maxLength: 100 })
  @Transform(collapseSpaces)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(NAME_PATTERN)
  firstName!: string;

  @ApiProperty({ example: 'Okafor', maxLength: 100 })
  @Transform(collapseSpaces)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(NAME_PATTERN)
  lastName!: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 72,
    writeOnly: true,
    description: '12 or more characters, at most 72 UTF-8 bytes.',
  })
  @IsString()
  @MinLength(12)
  @IsByteLength(0, 72)
  password!: string;
}
export class RefreshDto {
  @ApiProperty({
    writeOnly: true,
    description:
      'The current refresh token. Rotated on every successful refresh.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{86}$/)
  refreshToken!: string;
}
export class LoginDto {
  @ApiProperty({
    description: 'Email or international E.164 phone number',
    example: 'alice@example.com',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string;
  @ApiProperty({ writeOnly: true, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
export class WalletSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: Currency }) currency!: Currency;
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Ada' }) firstName!: string;
  @ApiProperty({ example: 'Okafor' }) lastName!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ example: '+2348012345678' }) phone!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({
    type: [WalletSummaryDto],
    description: 'Empty until POST /v1/wallets',
  })
  wallets!: WalletSummaryDto[];
}
export class AuthResponseDto {
  @ApiProperty({
    description: 'Signed JWT; use as Authorization: Bearer <token>.',
  })
  accessToken!: string;
  @ApiProperty({
    description:
      'Single-use refresh token. Store securely and replace after refresh.',
  })
  refreshToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) refreshExpiresAt!: Date;
  @ApiProperty({ type: UserResponseDto }) user!: UserResponseDto;
}
export class LogoutResponseDto {
  @ApiProperty() loggedOut!: boolean;
}
