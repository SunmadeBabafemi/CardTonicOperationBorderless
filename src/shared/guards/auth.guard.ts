import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchBlockResponse } from '@core/common/helpers/response';
import type { AuthenticatedRequest } from '@core/common/interfaces';
import { PUBLIC_ROUTE } from '@shared/decorators';
import { AuthenticationService } from '@shared/services/authentication.service';

/** Global guard: every route needs a valid bearer session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authentication: AuthenticationService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      if (
        this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
          context.getHandler(),
          context.getClass(),
        ])
      )
        return true;
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      request.principal = await this.authentication.authenticate(
        request.headers.authorization,
      );
      return true;
    } catch (error) {
      catchBlockResponse(error);
    }
  }
}
