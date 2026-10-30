import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ResponseObject } from '@core/common/helpers/response';
import { ApiSuccess } from '@core/common/openapi/apiResponse';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from '@shared/decorators';
import type { Principal } from '@core/common/interfaces';
import {
  AuthResponseDto,
  LoginDto,
  LogoutResponseDto,
  RegisterDto,
  RefreshDto,
  UserResponseDto,
} from './auth.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public()
  @Post('register')
  @ApiSuccess(AuthResponseDto, 201)
  async register(@Body() input: RegisterDto) {
    return ResponseObject.Ok(
      await this.auth.register(input),
      'Account created',
      201,
    );
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiSuccess(AuthResponseDto)
  async login(@Body() input: LoginDto) {
    return ResponseObject.Ok(await this.auth.login(input), 'Signed in');
  }
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiSuccess(AuthResponseDto)
  async refresh(@Body() input: RefreshDto) {
    return ResponseObject.Ok(
      await this.auth.refresh(input),
      'Session refreshed',
    );
  }
  @Get('profile')
  @ApiBearerAuth()
  @ApiSuccess(UserResponseDto)
  async profile(@CurrentUser() user: Principal) {
    return ResponseObject.Ok(await this.auth.profile(user.userId));
  }
  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiSuccess(LogoutResponseDto)
  async logout(@CurrentUser() user: Principal) {
    return ResponseObject.Ok(await this.auth.logout(user), 'Signed out');
  }
}
