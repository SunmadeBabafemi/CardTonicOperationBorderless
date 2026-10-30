import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchBlockResponse } from '../helpers/response';

/** Bring middleware/framework errors through the same service error flow. */
@Catch()
export class ResponseFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    try {
      catchBlockResponse(error, {
        requestId: response.locals.requestId as string | undefined,
        method: request.method,
        path: request.path,
      });
    } catch (normalized) {
      // catchBlockResponse only throws normalized HttpException instances.
      const exception = normalized as import('@nestjs/common').HttpException;
      response.status(exception.getStatus()).json(exception.getResponse());
    }
  }
}
