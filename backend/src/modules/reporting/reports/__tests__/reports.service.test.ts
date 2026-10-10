import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ lead: { groupBy: vi.fn() }, task: { count: vi.fn() }, campaign: { findMany: vi.fn() } }));
vi.mock('../../../../config/database.config', () => ({ default: db }));
import { getContactStatusBreakdown, getTaskCompletion, getCampaignSummary } from '../reports.service';
beforeEach(() => vi.resetAllMocks());
it('counts current unconverted Leads in the authorized tenant and assignment scope', async () => {
  db.lead.groupBy.mockResolvedValue([{ status: 'HOT', _count: { status: 3 } }]);
  expect(await getContactStatusBreakdown('tenant', 'agent')).toEqual([{ status: 'HOT', count: 3 }]);
  expect(db.lead.groupBy.mock.calls[0][0].where).toEqual({ tenantId: 'tenant', isArchived: false, deletedAt: null, convertedAt: null, assignedUserId: 'agent' });
});
it('keeps cancelled tasks out of pending and overdue without misreporting totals', async () => {
  db.task.count.mockResolvedValueOnce(20).mockResolvedValueOnce(12).mockResolvedValueOnce(3).mockResolvedValueOnce(6);
  expect(await getTaskCompletion('tenant', 'agent')).toEqual({ total: 20, completed: 12, overdue: 3, pending: 6 });
  for (const [query] of db.task.count.mock.calls) expect(query.where).toMatchObject({ tenantId: 'tenant', isArchived: false, assignedUserId: 'agent' });
  expect(db.task.count.mock.calls[2][0].where).toMatchObject({ dueDate: { lt: expect.any(Date) }, status: { notIn: ['completed', 'cancelled'] } });
  expect(db.task.count.mock.calls[3][0].where.status).toEqual({ notIn: ['completed', 'cancelled'] });
});
it('returns zero counts for an empty workspace', async () => {
  db.task.count.mockResolvedValue(0); db.lead.groupBy.mockResolvedValue([]);
  expect(await getTaskCompletion('tenant')).toEqual({ total: 0, completed: 0, overdue: 0, pending: 0 });
  expect(await getContactStatusBreakdown('tenant')).toEqual([]);
});
it('bounds campaign summary and excludes archived campaigns', async () => {
  db.campaign.findMany.mockResolvedValue([]); await getCampaignSummary('tenant');
  expect(db.campaign.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: 'tenant', isArchived: false }, take: 10, orderBy: { sentAt: 'desc' } });
});
