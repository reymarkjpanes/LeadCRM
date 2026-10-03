import { vi } from 'vitest';

export const tenant = {
  id: 'tenant-1', name: 'Workspace', status: 'SANDBOX',
  industry: null, companySize: null, website: null, currency: 'PHP',
  ownerUserId: 'user-1', onboardingStep: 0, onboardingCompletedAt: null as Date | null,
};
export const user = {
  id: 'user-1', tenantId: tenant.id, email: 'alice@gmail.com', firstName: 'Alice',
  lastName: 'Owner', role: 'Sales', status: 'ACTIVE', emailVerified: new Date('2026-01-01'),
  mustChangePassword: false,
  passwordHash: 'hash', avatarUrl: null, tenant,
};
const model = () => ({
  findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(),
  create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(),
});
export const db = {
  user: model(), tenant: model(), roleDefinition: model(), rolePermission: model(),
  userRole: model(), pipeline: model(), account: { ...model(), count: vi.fn() },
  passwordResetToken: model(), emailVerificationToken: model(), auditLog: model(), session: model(), $transaction: vi.fn(),
};

export function resetDb() {
  vi.resetAllMocks();
  Object.assign(tenant, {
    ownerUserId: user.id, onboardingStep: 0, onboardingCompletedAt: null,
    name: 'Workspace', industry: null, companySize: null, website: null,
  });
  Object.assign(user, { email: 'alice@camxian.com', mustChangePassword: false, role: 'Sales', status: 'ACTIVE', emailVerified: new Date('2026-01-01') });
  db.$transaction.mockImplementation(work => work(db));
  db.user.findFirst.mockResolvedValue(user);
  db.user.findMany.mockResolvedValue([user]);
  db.user.findUnique.mockResolvedValue(user);
  db.user.findUniqueOrThrow.mockResolvedValue(user);
  db.user.updateMany.mockResolvedValue({ count: 1 });
  db.user.create.mockImplementation(({ data }) => ({ ...user, ...data }));
  db.tenant.create.mockResolvedValue(tenant);
  db.tenant.updateMany.mockImplementation(({ where, data }) => {
    if ((where.onboardingStep !== undefined && where.onboardingStep !== tenant.onboardingStep) ||
        where.onboardingCompletedAt !== tenant.onboardingCompletedAt) return { count: 0 };
    Object.assign(tenant, data);
    return { count: 1 };
  });
  db.roleDefinition.upsert.mockResolvedValue({ id: 'sales-role' });
  db.roleDefinition.findUniqueOrThrow.mockResolvedValue({ id: 'sales-role', tenantId: tenant.id });
  // Existing sandbox seeder is tested independently; avoid creating sample data in service tests.
  db.account.count.mockResolvedValue(1);
}
