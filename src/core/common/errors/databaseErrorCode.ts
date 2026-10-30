export function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('driverError' in error) return databaseErrorCode(error.driverError);
  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
