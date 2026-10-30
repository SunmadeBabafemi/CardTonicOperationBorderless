import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { HttpCodesEnum } from '@core/common/enums/httpCodes.enum';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import jwt, { JwtPayload } from 'jsonwebtoken';
import type { Principal } from '@core/common/interfaces';
import { UserSession } from '@database/entities/userSession.entity';

/** Verifies bearer access tokens against live, unrevoked sessions. */
@Injectable()
export class AuthenticationService {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
  ) {}

  async authenticate(header?: string): Promise<Principal> {
    try {
      const match = /^Bearer ([A-Za-z0-9_.-]{1,4096})$/i.exec(header ?? '');
      if (!match) this.unauthorized();
      let claims: JwtPayload;
      try {
        const payload = jwt.verify(
          match[1],
          this.config.getOrThrow<string>('AUTH_JWT_SECRET'),
          {
            algorithms: ['HS256'],
            issuer: this.config.getOrThrow<string>('AUTH_JWT_ISSUER'),
            audience: this.config.getOrThrow<string>('AUTH_JWT_AUDIENCE'),
          },
        );
        if (
          typeof payload === 'string' ||
          payload.tokenUse !== 'access' ||
          !this.isUuid(payload.sub) ||
          !this.isUuid(payload.sid) ||
          !this.isUuid(payload.jti) ||
          !Number.isInteger(payload.exp) ||
          !Number.isInteger(payload.iat)
        )
          ErrorResponse('Invalid claims', HttpCodesEnum.HTTP_UNAUTHORIZED);
        claims = payload;
      } catch {
        this.unauthorized();
      }
      const session = await this.database.getRepository(UserSession).findOneBy({
        id: claims.sid as string,
        userId: claims.sub!,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      });
      if (!session) this.unauthorized();
      return { userId: session.userId, sessionId: session.id };
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  private isUuid(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }

  private unauthorized(message = 'A valid bearer session is required'): never {
    return ErrorResponse(message, 401);
  }
}
