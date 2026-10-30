import { HttpCodesEnum } from '../../enums/httpCodes.enum';
import type { BadRequest, NotFound, Ok } from './ResponseType';

/** Shared response contract adopted from event-ticket-app-api. */
export class ResponseObject {
  static Ok<T>(data: T, message = '', status = HttpCodesEnum.HTTP_OK): Ok<T> {
    return { status, data, success: true, message };
  }

  static OkFailue<T>(
    data: T,
    message = '',
    status = HttpCodesEnum.HTTP_BAD_REQUEST,
    errorCode = status,
  ) {
    return { status, data, success: false as const, message, errorCode };
  }

  static Error(
    error: string,
    message: string | string[] = '',
    errorCode = HttpCodesEnum.HTTP_SERVER_ERROR,
  ): BadRequest {
    return { status: 'failed', error, success: false, message, errorCode };
  }

  static NotFoundRequest(
    error = 'Not Found',
    message = '',
    errorCode = HttpCodesEnum.HTTP_NOT_FOUND,
  ): NotFound {
    return this.Error(error, message, errorCode);
  }
}
