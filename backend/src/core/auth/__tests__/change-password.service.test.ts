import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../../config/database.config', async () => ({ default: (await import('./auth-test-db')).db }));
vi.mock('../../../shared/helpers/crypto', () => ({ comparePassword: vi.fn(), hashPassword: vi.fn() }));
import { db, user, resetDb } from './auth-test-db';
import { comparePassword, hashPassword } from '../../../shared/helpers/crypto';
import { changePassword, ChangePasswordSchema } from '../change-password.service';
const actor = { userId: 'user-1', tenantId: 'tenant-1' };
const input = { password: 'Personal2!' };
beforeEach(() => { resetDb(); user.mustChangePassword = true; vi.mocked(hashPassword).mockResolvedValue('new-hash'); });
it('atomically stores the new hash, clears the requirement, revokes sessions and reset tokens', async () => {
  vi.mocked(comparePassword).mockResolvedValue(false);
  await changePassword(actor, input);
  expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: actor.userId, tenantId: actor.tenantId } });
  expect(db.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { passwordHash: 'new-hash', mustChangePassword: false, passwordChangedAt: expect.any(Date) } });
  expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: user.id } });
  expect(db.passwordResetToken.deleteMany).toHaveBeenCalled();
  expect(db.auditLog.create).toHaveBeenCalled();
});
it('rejects an unavailable account without changing credentials', async () => {
  db.user.findFirst.mockResolvedValueOnce(null);
  await expect(changePassword(actor, input)).rejects.toHaveProperty('statusCode', 400);
  expect(db.user.update).not.toHaveBeenCalled();
});
it('rejects reuse of the temporary password', async () => {
  vi.mocked(comparePassword).mockResolvedValue(true);
  await expect(changePassword(actor, input)).rejects.toHaveProperty('statusCode', 400);
  expect(db.user.update).not.toHaveBeenCalled();
});
it('uses the shared password-strength policy', () => {
  expect(ChangePasswordSchema.safeParse({ ...input, password: 'weak' }).success).toBe(false);
});
it('compares a lowercase temporary password before permanent password strength checks', async () => {
  vi.mocked(comparePassword).mockResolvedValue(true);
  await expect(changePassword(actor, { password: 'first.last42' })).rejects.toMatchObject({
    code: 'PASSWORD_REUSE', message: 'You cannot reuse your temporary password. Please choose a new password.',
  });
  expect(db.user.update).not.toHaveBeenCalled();
});
it('rejects weak different passwords on the backend', async () => {
  vi.mocked(comparePassword).mockResolvedValue(false);
  await expect(changePassword(actor, { password: 'different42' })).rejects.toHaveProperty('issues');
  expect(db.user.update).not.toHaveBeenCalled();
});
