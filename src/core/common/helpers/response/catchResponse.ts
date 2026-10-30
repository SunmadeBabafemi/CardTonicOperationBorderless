import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  RequestTimeoutException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { HttpCodesEnum } from '../../enums/httpCodes.enum';
import { ResponseObject } from './Response';
import type { BadRequest } from './ResponseType';
import { errorLogger, ErrorLogContext } from './errorLogger';

const INTERNAL_MESSAGE = 'Unable To Perform request at the moment';
const normalizedErrors = new WeakSet<HttpException>();
const originalErrors = new WeakMap<HttpException, unknown>();

/** Build the reference response inside a typed Nest HTTP exception. */
export function createErrorResponse(
  message: string | string[],
  code = HttpCodesEnum.HTTP_SERVER_ERROR,
): HttpException {
  const status =
    Number.isInteger(code) && code >= 400 && code <= 599
      ? code
      : HttpCodesEnum.HTTP_SERVER_ERROR;
  const name =
    status === HttpCodesEnum.HTTP_CONFLICT
      ? 'Conflict Request'
      : (STATUS_CODES[status] ?? 'Internal Server Error');
  const body = ResponseObject.Error(
    name,
    status === 500 ? INTERNAL_MESSAGE : message,
    status,
  );
  let exception: HttpException;
  switch (status) {
    case HttpCodesEnum.HTTP_BAD_REQUEST:
      exception = new BadRequestException(body);
      break;
    case HttpCodesEnum.HTTP_UNAUTHORIZED:
      exception = new UnauthorizedException(body);
      break;
    case HttpCodesEnum.HTTP_FORBIDDEN:
      exception = new ForbiddenException(body);
      break;
    case HttpCodesEnum.HTTP_NOT_FOUND:
      exception = new NotFoundException(body);
      break;
    case HttpCodesEnum.HTTP_REQUEST_TIMEOUT:
      exception = new RequestTimeoutException(body);
      break;
    case HttpCodesEnum.HTTP_CONFLICT:
      exception = new ConflictException(body);
      break;
    case HttpCodesEnum.HTTP_REQUEST_ENTITY_TOO_LARGE:
      exception = new PayloadTooLargeException(body);
      break;
    case HttpCodesEnum.HTTP_UNPROCESSABLE_ENTITY:
      exception = new UnprocessableEntityException(body);
      break;
    case HttpCodesEnum.HTTP_BAD_GATEWAY:
      exception = new BadGatewayException(body);
      break;
    case HttpCodesEnum.HTTP_SERVICE_UNAVAILABLE:
      exception = new ServiceUnavailableException(body);
      break;
    case HttpCodesEnum.HTTP_GATEWAY_TIMEOUT:
      exception = new GatewayTimeoutException(body);
      break;
    case HttpCodesEnum.HTTP_SERVER_ERROR:
      exception = new InternalServerErrorException(body);
      break;
    default:
      exception = new HttpException(body, status);
  }
  // Diagnostic exception text remains server-side; the response always uses body.
  if (status === 500)
    exception.message = Array.isArray(message) ? message.join('; ') : message;
  normalizedErrors.add(exception);
  return exception;
}

/** Expected service failures use the same throwing helper as the reference. */
export function ErrorResponse(
  message: string | string[],
  code = HttpCodesEnum.HTTP_SERVER_ERROR,
): never {
  throw createErrorResponse(message, code);
}

function errorMessage(body: unknown, fallback: string): string | string[] {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'message' in body) {
    if (typeof body.message === 'string') return body.message;
    if (
      Array.isArray(body.message) &&
      body.message.every((value) => typeof value === 'string')
    )
      return body.message;
  }
  return fallback;
}

/** Normalize service, framework, guard and validation failures without raw objects. */
export function catchBlockResponse(
  error: unknown,
  context?: ErrorLogContext,
): never {
  const status =
    error instanceof HttpException
      ? error.getStatus()
      : HttpCodesEnum.HTTP_SERVER_ERROR;
  const body = error instanceof HttpException ? error.getResponse() : null;
  const normalized =
    error instanceof HttpException && normalizedErrors.has(error)
      ? error
      : createErrorResponse(errorMessage(body, INTERNAL_MESSAGE), status);
  if (normalized !== error) originalErrors.set(normalized, error);
  if (context)
    errorLogger(
      normalized.getStatus(),
      (normalized.getResponse() as BadRequest).error,
      context,
      originalErrors.get(normalized) ?? normalized,
    );
  throw normalized;
}
