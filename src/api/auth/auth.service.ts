import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import jwt from 'jsonwebtoken';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { databaseErrorCode } from '@core/common/errors/databaseErrorCode';
import { User } from '@database/entities/user.entity';
import { UserSession } from '@database/entities/userSession.entity';
import { RefreshToken } from '@database/entities/refreshToken.entity';
import { Wallet } from '@database/entities/wallet.entity';
import { CURRENCIES } from '@core/common/money/currency';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import { hashPassword, verifyPassword } from './password';
import type { Principal } from '@core/common/interfaces';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DataSource,
    private readonly config: ConfigService,
  ) {}

  async register(input: RegisterDto) {
    try {
      const phone = parsePhoneNumberFromString(input.phone);
      if (!phone?.isValid())
        ErrorResponse('Provide a valid international mobile number', 400);
      const passwordHash = await hashPassword(input.password);

      return await this.database.transaction(async (manager) => {
        const user = await manager.getRepository(User).save({
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          phone: phone.number,
          passwordHash,
        });
        return this.issueSession(manager, user);
      });
    } catch (error) {
      if (databaseErrorCode(error) === '23505')
        ErrorResponse('This identity is already registered', 409);
      catchBlockResponse(error);
    }
  }

  async login(input: LoginDto) {
    try {
      const identifier = input.identifier.trim().toLowerCase();
      const user = await this.database
        .getRepository(User)
        .createQueryBuilder('u')
        .addSelect('u.passwordHash')
        .where('u.email = :identifier OR u.phone = :identifier', { identifier })
        .getOne();
      if (!(await verifyPassword(input.password, user?.passwordHash)) || !user)
        this.unauthorized('Invalid credentials');
      return await this.database.transaction(async (manager) => {
        // Upgrade existing scrypt accounts without locking out their users. Legacy
        // passwords above bcrypt's byte limit stay verifiable until changed.
        if (
          user.passwordHash.startsWith('scrypt$') &&
          Buffer.byteLength(input.password, 'utf8') <= 72
        ) {
          const passwordHash = await hashPassword(input.password);
          await manager.getRepository(User).update(user.id, { passwordHash });
        }
        return this.issueSession(manager, user);
      });
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  private async issueSession(manager: EntityManager, user: User) {
    const session = await manager.getRepository(UserSession).save({
      userId: user.id,
      expiresAt: new Date(
        Date.now() +
          this.config.getOrThrow<number>('AUTH_REFRESH_TTL_SECONDS') * 1000,
      ),
      revokedAt: null,
    });
    return this.issueTokens(manager, user, session);
  }

  private async issueTokens(
    manager: EntityManager,
    user: User,
    session: UserSession,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.min(
      now + this.config.getOrThrow<number>('AUTH_ACCESS_TTL_SECONDS'),
      Math.floor(session.expiresAt.getTime() / 1000),
    );
    const accessToken = jwt.sign(
      { sid: session.id, tokenUse: 'access', iat: now, exp },
      this.config.getOrThrow<string>('AUTH_JWT_SECRET'),
      {
        algorithm: 'HS256',
        subject: user.id,
        issuer: this.config.getOrThrow<string>('AUTH_JWT_ISSUER'),
        audience: this.config.getOrThrow<string>('AUTH_JWT_AUDIENCE'),
        jwtid: randomUUID(),
      },
    );
    const refreshToken = randomBytes(64).toString('base64url');
    await manager.getRepository(RefreshToken).insert({
      tokenHash: this.digest(refreshToken),
      sessionId: session.id,
      usedAt: null,
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresAt: new Date(exp * 1000),
      refreshExpiresAt: session.expiresAt,
      user: await this.profile(user.id, manager),
    };
  }

  async refresh(input: RefreshDto) {
    try {
      const tokenHash = this.digest(input.refreshToken);
      const result = await this.database.transaction(async (manager) => {
        const repository = manager.getRepository(RefreshToken);
        const record = await repository.findOneBy({ tokenHash });
        if (!record) return null;
        // Every rotation/logout in this family locks the session first. Re-read
        // the token after locking so concurrent refreshes cannot both succeed.
        const session = await manager.getRepository(UserSession).findOne({
          where: { id: record.sessionId },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !session ||
          session.revokedAt ||
          session.expiresAt.getTime() <= Date.now()
        )
          return null;
        const current = await repository.findOneByOrFail({ tokenHash });
        if (current.usedAt) {
          await manager
            .getRepository(UserSession)
            .update(session.id, { revokedAt: new Date() });
          // Return rather than throw so the revocation commits before the 401.
          return null;
        }
        await repository.update({ tokenHash }, { usedAt: new Date() });
        const user = await manager
          .getRepository(User)
          .findOneByOrFail({ id: session.userId });
        return this.issueTokens(manager, user, session);
      });
      if (!result) this.unauthorized('Invalid or expired refresh token');
      return result;
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  async profile(userId: string, manager = this.database.manager) {
    try {
      const user = await manager
        .getRepository(User)
        .findOneByOrFail({ id: userId });
      const wallets = await manager.getRepository(Wallet).find({
        select: { id: true, currency: true },
        where: { userId },
      });
      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt,
        wallets: CURRENCIES.flatMap((currency) =>
          wallets
            .filter((wallet) => wallet.currency === currency)
            .map(({ id }) => ({ id, currency })),
        ),
      };
    } catch (error) {
      catchBlockResponse(error);
    }
  }

  async logout(principal: Principal) {
    try {
      await this.database
        .getRepository(UserSession)
        .update(
          { id: principal.sessionId, userId: principal.userId },
          { revokedAt: new Date() },
        );
      return { loggedOut: true };
    } catch (error) {
      catchBlockResponse(error);
    }
  }
  private digest(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private unauthorized(message = 'A valid bearer session is required'): never {
    return ErrorResponse(message, 401);
  }
}
