import type { Request } from 'express';

/** The authenticated user and session behind a request. */
export interface Principal {
  userId: string;
  sessionId: string;
}

export type AuthenticatedRequest = Request & { principal: Principal };
