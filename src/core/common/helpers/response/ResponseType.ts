export interface Ok<T> {
  status: number;
  data: T;
  success: true;
  message: string;
}

export interface BadRequest {
  status: 'failed';
  error: string;
  success: false;
  message: string | string[];
  errorCode: number;
}

export type NotFound = BadRequest;
