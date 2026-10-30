import {
  catchBlockResponse,
  ErrorResponse,
} from '@core/common/helpers/response';
import { scrypt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';

const COST = 12;
// A fixed valid hash keeps unknown-account checks on the same bcrypt path.
const DUMMY_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5c5UEi4Q7fRjC7hQyjh0CpxuRQfFWrO';

export async function hashPassword(password: string): Promise<string> {
  try {
    if (Buffer.byteLength(password, 'utf8') > 72)
      ErrorResponse('Password must not exceed 72 UTF-8 bytes', 400);
    return await bcrypt.hash(password, COST);
  } catch (error) {
    catchBlockResponse(error);
  }
}

export async function verifyPassword(
  password: string,
  encoded?: string,
): Promise<boolean> {
  try {
    // Read compatibility for existing accounts; new hashes always use bcrypt.
    if (encoded?.startsWith('scrypt$'))
      return await verifyLegacy(password, encoded);
    const matches = await bcrypt.compare(password, encoded ?? DUMMY_HASH);
    return (
      Boolean(encoded) && Buffer.byteLength(password, 'utf8') <= 72 && matches
    );
  } catch (error) {
    catchBlockResponse(error);
  }
}

async function verifyLegacy(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [, salt, expected] = encoded.split('$');
  if (
    !/^[a-f0-9]{32}$/.test(salt ?? '') ||
    !/^[a-f0-9]{128}$/.test(expected ?? '')
  )
    return false;
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
