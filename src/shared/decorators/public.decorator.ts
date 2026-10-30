import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'publicRoute';

/** Skips the global bearer-session guard for a route or controller. */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
