import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { db, resetDb, user } from './auth-test-db';
const storage = vi.hoisted(() => ({ put: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock('../../../config/database.config', () => ({ default: db }));
// The runtime uses private mounted storage; keep this boundary fixture aligned.
vi.mock('../../../shared/services/private-object-storage', () => ({ privateObjectStorage: () => storage }));
import { updateSelfProfile, uploadSelfAvatar, readSelfAvatar } from '../profile.service';
import { AVATAR_MAX_BYTES, SelfProfileFieldSchemas, UpdateSelfProfileSchema } from '@leadcrm/shared';

beforeEach(() => {
  resetDb();
  Object.assign(user, { avatarUrl: null });
  db.user.update.mockImplementation(({ data }) => { Object.assign(user, data); return user; });
  storage.put.mockResolvedValue(undefined); storage.remove.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('updates only the authenticated tenant user, audits and returns canonical profile fields', async () => {
  const result = await updateSelfProfile(user.id, user.tenantId, { firstName: ' Ada ', lastName: ' Lovelace ', phone: '9123456789' });
  expect(db.user.update).toHaveBeenCalledWith({ where: { id: user.id, tenantId: user.tenantId }, data: { firstName: 'Ada', lastName: 'Lovelace', phone: '+639123456789' } });
  expect(result).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', phone: '+639123456789', groups: [] });
  expect(result).not.toHaveProperty('passwordHash');
  expect(db.auditLog.create).toHaveBeenCalledOnce();
});

it.each(['John', 'Mary Jane', 'Anne-Marie', "O'Connor", 'María', 'Mari\u0301a', '李', 'अर्जुन', 'O‘Connor', 'O’Connor', 'Anne‐Marie', 'Anne‑Marie', 'A'.repeat(100), ' Ada '])('persists the valid profile name %s', async value => {
  const result = await updateSelfProfile(user.id, user.tenantId, { firstName: value, lastName: value });
  expect(db.user.update).toHaveBeenCalledExactlyOnceWith({
    where: { id: user.id, tenantId: user.tenantId },
    data: { firstName: value.trim(), lastName: value.trim() },
  });
  expect(result).toMatchObject({ firstName: value.trim(), lastName: value.trim() });
});

it.each(([
  ['firstName', 'First name'], ['lastName', 'Last name'],
] as const).flatMap(([field, label]) => [
  ...['@', '#', '$', '%', '&', '*', '+', '=', '!', '_', '.', '/', '\\', '(', ')', '"', '😀', '—', '\t', '\n', '\0'].map(symbol => ({
    field, value: `John${symbol}`, message: `${label} must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().`,
  })),
  ...['John123', 'John1@', 'A'.repeat(101) + '@1'].map(value => ({ field, value, message: `${label} must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().` })),
  { field, value: 'A'.repeat(101) + '@', message: `${label} must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().` },
  { field, value: '', message: `${label} is required` },
  { field, value: '   ', message: `${label} is required` },
  { field, value: 'A'.repeat(101), message: `${label} must not exceed 100 characters.` },
]))('rejects invalid $field "$value" before database or audit writes', async ({ field, value, message }) => {
  const parsed = SelfProfileFieldSchemas[field].safeParse(value);
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.issues[0].message).toBe(message);
  await expect(updateSelfProfile(user.id, user.tenantId, { [field]: value })).rejects.toThrow(message);
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(db.user.update).not.toHaveBeenCalled();
  expect(db.auditLog.create).not.toHaveBeenCalled();
});

it('keeps omitted profile names optional for partial updates', async () => {
  expect(UpdateSelfProfileSchema.parse({ phone: null })).toEqual({ phone: null });
  const result = await updateSelfProfile(user.id, user.tenantId, { phone: null });
  expect(db.user.update).toHaveBeenCalledExactlyOnceWith({ where: { id: user.id, tenantId: user.tenantId }, data: { phone: null } });
  expect(result).toMatchObject({ firstName: user.firstName, lastName: user.lastName });
});

it.each([
  ['phone', '8123456789'], ['phone', '09123456789'], ['phone', '912345678'], ['phone', '91234567890'], ['phone', '91234abc90'],
  ['firstName', 'F'.repeat(101)], ['lastName', 'L'.repeat(101)], ['jobTitle', 'J'.repeat(101)], ['department', 'D'.repeat(101)],
])('rejects invalid profile %s value', async (field, value) => {
  await expect(updateSelfProfile(user.id, user.tenantId, { [field]: value } as any)).rejects.toThrow();
  expect(db.user.update).not.toHaveBeenCalled();
});
it.each(['role', 'tenantId', 'userId', 'status', 'permissions', 'passwordHash', 'email', 'jobTitle', 'avatarUrl', 'department', 'groupIds', 'groups'])('rejects self-editing %s', async field => {
  await expect(updateSelfProfile(user.id, user.tenantId, { [field]: 'forged' } as any)).rejects.toThrow();
  expect(db.user.update).not.toHaveBeenCalled();
});
it('rejects missing tenant ownership and obsolete profile timezone fields', async () => {
  db.user.findFirst.mockResolvedValue(null);
  await expect(updateSelfProfile(user.id, 'wrong-tenant', { firstName: 'Ada' })).rejects.toThrow('Authentication required');
  await expect(updateSelfProfile(user.id, user.tenantId, { firstName: 'Ada', ...{ timeZone: 'Asia/Manila' } })).rejects.toThrow();
});
it('uploads only decoded, optimized images and persists a durable private reference', async () => {
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#123456' } }).png().toBuffer();
  const result = await uploadSelfAvatar(user.id, user.tenantId, png, 'image/png');
  expect(result.avatarUrl).toMatch(/^\/api\/proxy\/auth\/profile\/avatar\/[a-f0-9-]{36}$/);
  expect(user.avatarUrl).toBe(result.avatarUrl);
  const [key, bytes] = storage.put.mock.calls[0];
  expect(key).toMatch(new RegExp(`^${user.tenantId}/${user.id}/[a-f0-9-]{36}\\.webp$`));
  expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 512, height: 512 });
});
it('rejects disguised, oversized and unsupported uploads before storage', async () => {
  for (const [bytes, mime] of [[Buffer.from('<svg/>'), 'image/png'], [Buffer.from('text'), 'text/html'], [Buffer.alloc(AVATAR_MAX_BYTES + 1), 'image/jpeg']] as const) {
    await expect(uploadSelfAvatar(user.id, user.tenantId, bytes, mime)).rejects.toThrow();
  }
  expect(storage.put).not.toHaveBeenCalled();
});
it('keeps the previous database avatar on storage failure and denies other avatar references', async () => {
  storage.put.mockRejectedValue(new Error('Unable to access private file storage.'));
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
  await expect(uploadSelfAvatar(user.id, user.tenantId, png, 'image/png')).rejects.toThrow('Unable to access private file storage');
  expect(db.user.update).not.toHaveBeenCalled();
  await expect(readSelfAvatar(user.id, user.tenantId, 'another-user-avatar')).rejects.toThrow('not found');
});
