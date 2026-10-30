import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'X-Webhook-Signature';

/** Hex HMAC-SHA512 of the exact request body bytes. */
export function signWebhookBody(secret: string, body: string | Buffer): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

export function isValidWebhookSignature(
  secret: string,
  body: Buffer,
  signature: string,
): boolean {
  if (!/^[0-9a-f]{128}$/i.test(signature)) return false;
  return timingSafeEqual(
    Buffer.from(signWebhookBody(secret, body), 'hex'),
    Buffer.from(signature, 'hex'),
  );
}
