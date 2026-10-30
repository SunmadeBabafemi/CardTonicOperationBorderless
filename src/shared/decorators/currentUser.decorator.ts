import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, Principal } from '@core/common/interfaces';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().principal,
);
