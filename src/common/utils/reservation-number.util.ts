import { randomBytes } from 'crypto';

export function generateReservationNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = randomBytes(3).toString('hex').toUpperCase();
  return `RES-${timestamp}-${random}`;
}
