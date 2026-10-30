import {
  BadRequestException,
  Logger,
  HttpException,
  InternalServerErrorException,
  RequestTimeoutException,
} from '@nestjs/common';
import { NEVER, throwError } from 'rxjs';
import {
  catchBlockResponse,
  createErrorResponse,
  ErrorResponse,
  ResponseObject,
} from '@core/common/helpers/response';
import { TimeoutInterceptor } from '@core/common/interceptors/timeout.interceptor';
import type { ExecutionContext } from '@nestjs/common';

function capture(action: () => never): HttpException {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error('Expected the error helper to throw');
}

describe('event-ticket-app-api response and error flow', () => {
  it('uses the reference success contract', () => {
    expect(ResponseObject.Ok({ id: 'id' }, 'Created', 201)).toEqual({
      status: 201,
      data: { id: 'id' },
      success: true,
      message: 'Created',
    });
    expect(ResponseObject.Ok(null)).toEqual({
      status: 200,
      data: null,
      success: true,
      message: '',
    });
  });

  it.each([400, 401, 403, 404, 408, 409, 413, 422, 429, 502, 503, 504])(
    'normalizes HTTP %s without changing the status or exposing raw objects',
    (status) => {
      const error = capture(() => ErrorResponse('Controlled failure', status));
      expect(error.getStatus()).toBe(status);
      const body = error.getResponse();
      expect(body).toMatchObject({
        status: 'failed',
        success: false,
        message: 'Controlled failure',
        errorCode: status,
      });
      expect(Object.keys(body).sort()).toEqual([
        'error',
        'errorCode',
        'message',
        'status',
        'success',
      ]);
      expect(typeof (body as { error: string }).error).toBe('string');
      expect(capture(() => catchBlockResponse(error))).toBe(error);
    },
  );

  it('normalizes framework validation arrays and strings', () => {
    const error = capture(() =>
      catchBlockResponse(
        new BadRequestException([
          'email must be an email',
          'password is too short',
        ]),
      ),
    );
    expect(error.getResponse()).toEqual({
      status: 'failed',
      error: 'Bad Request',
      success: false,
      message: ['email must be an email', 'password is too short'],
      errorCode: 400,
    });
    expect(
      capture(() =>
        catchBlockResponse(new HttpException('Missing', 404)),
      ).getResponse(),
    ).toEqual({
      status: 'failed',
      error: 'Not Found',
      success: false,
      message: 'Missing',
      errorCode: 404,
    });
  });

  it.each([
    new Error('SQL containing private-password and access-token'),
    {
      message: 'private-password',
      query: 'sensitive SQL',
      parameters: ['access-token'],
    },
    new InternalServerErrorException('private-password'),
    null,
  ])(
    'replaces unknown failures with a safe reference 500 response',
    (input) => {
      const error = capture(() => catchBlockResponse(input));
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(error.getResponse()).toEqual({
        status: 'failed',
        error: 'Internal Server Error',
        success: false,
        message: 'Unable To Perform request at the moment',
        errorCode: 500,
      });
      expect(JSON.stringify(error.getResponse())).not.toMatch(
        /SQL|private-password|access-token|stack|parameters/,
      );
    },
  );

  it('logs request context and stack frames without SQL, credentials, or response diagnostics', () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    try {
      capture(() =>
        catchBlockResponse(new Error('private-password in SQL'), {
          requestId: 'request-id',
          method: 'POST',
          path: '/v1/transfers',
        }),
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatchObject({
        requestId: 'request-id',
        method: 'POST',
        path: '/v1/transfers',
        errorCode: 500,
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(
        /private-password|in SQL/,
      );
    } finally {
      log.mockRestore();
    }
  });

  it('keeps configuration diagnostics outside the HTTP response', () => {
    const error = capture(() =>
      ErrorResponse('AUTH_JWT_SECRET must be configured', 500),
    );
    expect(error.message).toContain('AUTH_JWT_SECRET');
    expect(JSON.stringify(error.getResponse())).not.toContain(
      'AUTH_JWT_SECRET',
    );
    expect(capture(() => catchBlockResponse(error))).toBe(error);
  });

  it('creates normalized exceptions for middleware without throwing prematurely', () => {
    const error = createErrorResponse(
      'The request body contains malformed JSON',
      400,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({
      status: 'failed',
      errorCode: 400,
    });
  });

  it('uses the reference timeout flow with the shared response body', () => {
    jest.useFakeTimers();
    let failure: unknown;
    const subscription = new TimeoutInterceptor()
      .intercept({} as ExecutionContext, { handle: () => NEVER })
      .subscribe({
        error: (error) => {
          failure = error;
        },
      });
    try {
      jest.advanceTimersByTime(30000);
      expect(failure).toBeInstanceOf(RequestTimeoutException);
      expect((failure as HttpException).getResponse()).toMatchObject({
        status: 'failed',
        error: 'Request Timeout',
        success: false,
        errorCode: 408,
      });
    } finally {
      subscription.unsubscribe();
      jest.useRealTimers();
    }
  });

  it('keeps existing HTTP exceptions normalized through the timeout interceptor', () => {
    const expected = createErrorResponse('Quote expired', 409);
    let actual: unknown;
    new TimeoutInterceptor()
      .intercept({} as ExecutionContext, {
        handle: () => throwError(() => expected),
      })
      .subscribe({
        error: (error) => {
          actual = error;
        },
      });
    expect(actual).toBe(expected);
  });
});
