import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { catchBlockResponse, ErrorResponse } from '../helpers/response';
import { HttpCodesEnum } from '../enums/httpCodes.enum';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    return next.handle().pipe(
      timeout(30000),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError)
          ErrorResponse(
            'Request timed out. Retry a money request with its original idempotency key.',
            HttpCodesEnum.HTTP_REQUEST_TIMEOUT,
          );
        return catchBlockResponse(error);
      }),
    );
  }
}
