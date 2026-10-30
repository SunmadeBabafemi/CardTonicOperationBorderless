import { createErrorResponse } from '@core/common/helpers/response';
import { randomUUID } from 'node:crypto';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { setupSwagger } from './swagger';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';

/** Shared by runtime and API tests so the tested HTTP contract matches production. */
export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService);
  const logger = new Logger('HTTP');
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    const started = Date.now();
    response.on('finish', () => {
      if (config.get<string>('NODE_ENV') !== 'test')
        logger.log({
          requestId,
          method: request.method,
          path: request.path,
          status: response.statusCode,
          duration: `${Date.now() - started}ms`,
        });
    });
    next();
  });
  app.use(
    '/v1/auth',
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  // Swagger's bundled UI needs its inline initialization script.
  app.use(helmet({ contentSecurityPolicy: false }));
  // Keep the exact bytes so provider webhook signatures can be verified.
  const parseJson = json({
    limit: '16kb',
    verify: (request: Request & { rawBody?: Buffer }, _response, buffer) => {
      request.rawBody = buffer;
    },
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    parseJson(request, response, (error: unknown) => {
      const type =
        typeof error === 'object' && error !== null && 'type' in error
          ? error.type
          : undefined;
      if (type === 'entity.parse.failed')
        return next(
          createErrorResponse('The request body contains malformed JSON', 400),
        );
      if (type === 'entity.too.large')
        return next(createErrorResponse('The request body exceeds 16 KB', 413));
      next(error);
    });
  });
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: config.getOrThrow<number>('RATE_LIMIT_PER_MINUTE'),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_request, _response, next) =>
        next(createErrorResponse('Too many requests', 429)),
    }),
  );
  app.use(
    ['/v1/auth/login', '/v1/auth/register', '/v1/auth/refresh'],
    rateLimit({
      windowMs: 60000,
      limit: config.getOrThrow<number>('AUTH_RATE_LIMIT_PER_MINUTE'),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_request, _response, next) =>
        next(createErrorResponse('Too many authentication attempts', 429)),
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );
  app.useGlobalInterceptors(new TimeoutInterceptor());
  setupSwagger(app);
}
