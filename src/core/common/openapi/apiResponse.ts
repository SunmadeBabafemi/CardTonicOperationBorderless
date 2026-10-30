import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
  ApiHeader,
} from '@nestjs/swagger';

/** Keep Swagger aligned with the shared response envelope. */
export function ApiSuccess(model: Type<unknown>, status = 200) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      schema: {
        type: 'object',
        required: ['success', 'message', 'status', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          status: { type: 'integer', example: status },
          data: { $ref: getSchemaPath(model) },
        },
      },
    }),
    ...[400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504].map(
      (code) =>
        ApiResponse({
          status: code,
          schema: {
            type: 'object',
            required: ['status', 'error', 'success', 'message', 'errorCode'],
            properties: {
              success: { type: 'boolean', example: false },
              message: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
              },
              status: { type: 'string', enum: ['failed'], example: 'failed' },
              error: {
                type: 'string',
                example: code === 409 ? 'Conflict Request' : undefined,
              },
              errorCode: { type: 'integer', example: code },
            },
          },
        }),
    ),
  );
}

export function ApiIdempotency() {
  return ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      '8–128 letters, digits, hyphens or underscores. Reuse for retries; a changed payload conflicts.',
    schema: { type: 'string', example: 'deposit-alice-0001' },
  });
}
