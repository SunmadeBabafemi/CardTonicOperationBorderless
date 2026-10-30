import { ErrorResponse } from '@core/common/helpers/response';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  signWebhookBody,
  WEBHOOK_SIGNATURE_HEADER,
} from '@core/common/helpers/webhook/webhookSignature';
import { SignBankCreditDto } from './dto/signBankCredit.dto';

/** Local helpers that stand in for external parties. Never available in production. */
@Injectable()
export class DevToolsService {
  constructor(private readonly config: ConfigService) {}

  assertEnabled(): void {
    if (this.config.get<string>('NODE_ENV') === 'production')
      ErrorResponse('Cannot find this route', 404);
  }

  /** Builds and signs a bank-credit webhook exactly as the provider would send it. */
  signBankCredit(input: SignBankCreditDto) {
    this.assertEnabled();
    const secret = this.config.getOrThrow<string>('VBA_WEBHOOK_SECRET');
    if (!secret)
      ErrorResponse(
        'Set VBA_WEBHOOK_SECRET and restart the API to sign webhooks',
        503,
      );
    const body = JSON.stringify({
      settlementId:
        input.settlementId ??
        `STL-${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      accountNumber: input.accountNumber,
      amount: input.amount,
      ...(input.sourceAccountName
        ? { sourceAccountName: input.sourceAccountName }
        : {}),
      ...(input.narration ? { narration: input.narration } : {}),
    });
    return {
      body,
      header: WEBHOOK_SIGNATURE_HEADER,
      signature: signWebhookBody(secret, body),
      target: 'POST /v1/webhooks/virtual-bank-accounts/credits',
    };
  }
}
