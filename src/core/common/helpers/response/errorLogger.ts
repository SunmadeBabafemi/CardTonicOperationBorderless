import { Logger } from '@nestjs/common';

export interface ErrorLogContext {
  requestId?: string;
  method?: string;
  path?: string;
}
const logger = new Logger('ApplicationError');

/** Log server-side context without credentials, SQL, or request bodies. */
export function errorLogger(
  status: number,
  name: string,
  context: ErrorLogContext,
  cause?: unknown,
) {
  const stack =
    cause instanceof Error && status >= 500
      ? cause.stack
          ?.split('\n')
          .filter((line) => /^\s+at\s/.test(line))
          .slice(0, 20)
          .join('\n')
      : undefined;
  const entry = {
    ...context,
    errorCode: status,
    error: name,
    ...(stack ? { stack } : {}),
  };
  if (status >= 500) logger.error(entry);
  else logger.warn(entry);
}
