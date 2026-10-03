import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../config/database.config', async () => ({ default: (await import('./auth-test-db')).db }));
import { db, user, resetDb } from './auth-test-db';
import { verifyEmailToken } from '../verification.service';
beforeEach(() => { resetDb(); Object.assign(user, { status: 'PENDING', emailVerified: null }); });
it('consumes an account verification link once while retaining its user binding', async () => {
  db.emailVerificationToken.findUnique.mockResolvedValue({ userId: user.id, usedAt: null, expiresAt: new Date(Date.now() + 60000) });
  await verifyEmailToken('a'.repeat(64));
  expect(db.user.updateMany).toHaveBeenCalledWith({ where: { id: user.id, status: 'PENDING', emailVerified: null }, data: { status: 'ACTIVE', emailVerified: expect.any(Date) } });
  expect(db.emailVerificationToken.updateMany).toHaveBeenCalledWith({ where: { userId: user.id, usedAt: null }, data: { usedAt: expect.any(Date) } });
});
it('rejects replayed links before changing an account', async () => {
  db.emailVerificationToken.findUnique.mockResolvedValue({
    userId: user.id, usedAt: new Date(), expiresAt: new Date(Date.now() + 60000),
  });
  await expect(verifyEmailToken('a'.repeat(64))).rejects.toThrow('Invalid or expired');
  expect(db.user.updateMany).not.toHaveBeenCalled();
});
it('rejects a valid link if the account was subsequently deactivated', async () => {
  user.status = 'INACTIVE';
  db.emailVerificationToken.findUnique.mockResolvedValue({
    userId: user.id, usedAt: null, expiresAt: new Date(Date.now() + 60000),
  });
  await expect(verifyEmailToken('a'.repeat(64))).rejects.toThrow('no longer valid');
  expect(db.user.updateMany).not.toHaveBeenCalled();
});
