import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { db, resetDb, user } from './auth-test-db';
vi.mock('../../../config/database.config', () => ({ default: db }));
import { updateSelfProfile, uploadSelfAvatar, readSelfAvatar } from '../profile.service';
import { AVATAR_MAX_BYTES } from '@leadcrm/shared';

beforeEach(() => {
  resetDb();
  Object.assign(user, { avatarUrl: null });
  db.user.update.mockImplementation(({ data }) => { Object.assign(user, data); return user; });
  vi.stubEnv('SUPABASE_URL', 'https://storage.example.com');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-server-key');
  vi.stubEnv('SUPABASE_AVATAR_BUCKET', 'avatars');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('updates only the authenticated tenant user, audits and returns canonical profile fields', async () => {
  const result = await updateSelfProfile(user.id, user.tenantId, { firstName: ' Ada ', lastName: ' Lovelace ', phone: '9123456789', jobTitle: ' Engineer ' });
  expect(db.user.update).toHaveBeenCalledWith({ where: { id: user.id, tenantId: user.tenantId }, data: { firstName: 'Ada', lastName: 'Lovelace', phone: '+639123456789', jobTitle: 'Engineer' } });
  expect(result).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace', phone: '+639123456789', groups: [] });
  expect(result).not.toHaveProperty('passwordHash');
  expect(db.auditLog.create).toHaveBeenCalledOnce();
});
it.each([
  ['phone', '8123456789'], ['phone', '09123456789'], ['phone', '912345678'], ['phone', '91234567890'], ['phone', '91234abc90'],
  ['firstName', 'F'.repeat(51)], ['lastName', 'L'.repeat(51)], ['jobTitle', 'J'.repeat(101)], ['department', 'D'.repeat(101)],
])('rejects invalid profile %s value', async (field, value) => {
  await expect(updateSelfProfile(user.id, user.tenantId, { [field]: value } as any)).rejects.toThrow();
  expect(db.user.update).not.toHaveBeenCalled();
});
it.each(['role', 'tenantId', 'userId', 'status', 'permissions', 'passwordHash', 'email', 'avatarUrl', 'department', 'groupIds', 'groups'])('rejects self-editing %s', async field => {
  await expect(updateSelfProfile(user.id, user.tenantId, { [field]: 'forged' } as any)).rejects.toThrow();
  expect(db.user.update).not.toHaveBeenCalled();
});
it('rejects missing tenant ownership and obsolete profile timezone fields', async () => {
  db.user.findFirst.mockResolvedValue(null);
  await expect(updateSelfProfile(user.id, 'wrong-tenant', { firstName: 'Ada' })).rejects.toThrow('Authentication required');
  await expect(updateSelfProfile(user.id, user.tenantId, { firstName: 'Ada', ...{ timeZone: 'Asia/Manila' } })).rejects.toThrow();
});
it('uploads only decoded, optimized images and persists a durable private reference', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#123456' } }).png().toBuffer();
  const result = await uploadSelfAvatar(user.id, user.tenantId, png, 'image/png');
  expect(result.avatarUrl).toMatch(/^\/api\/proxy\/auth\/profile\/avatar\/[a-f0-9-]{36}$/);
  expect(user.avatarUrl).toBe(result.avatarUrl);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toContain(`/avatars/${user.tenantId}/${user.id}/`);
  expect(options.headers).toMatchObject({ 'Content-Type': 'image/webp', 'x-upsert': 'false' });
  expect(await sharp(Buffer.from(options.body)).metadata()).toMatchObject({ format: 'webp', width: 512, height: 512 });
  expect(result.avatarUrl).not.toContain('test-server-key');
});
it('rejects disguised, oversized and unsupported uploads before storage', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  for (const [bytes, mime] of [[Buffer.from('<svg/>'), 'image/png'], [Buffer.from('text'), 'text/html'], [Buffer.alloc(AVATAR_MAX_BYTES + 1), 'image/jpeg']] as const) {
    await expect(uploadSelfAvatar(user.id, user.tenantId, bytes, mime)).rejects.toThrow();
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
it('keeps the previous database avatar on storage failure and denies other avatar references', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
  await expect(uploadSelfAvatar(user.id, user.tenantId, png, 'image/png')).rejects.toThrow('Unable to store');
  expect(db.user.update).not.toHaveBeenCalled();
  await expect(readSelfAvatar(user.id, user.tenantId, 'another-user-avatar')).rejects.toThrow('not found');
});
