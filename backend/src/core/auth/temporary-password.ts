import { randomInt } from 'node:crypto';

/** ASCII normalization keeps the readable credential within bcrypt's 72-byte limit. */
export function generateTemporaryPassword(firstName: string, lastName: string): string {
  const part = (name: string, fallback: string) => name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 34) || fallback;
  return `${part(firstName, 'user')}.${part(lastName, 'account')}${randomInt(0, 100).toString().padStart(2, '0')}`;
}
