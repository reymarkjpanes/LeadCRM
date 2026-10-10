import prisma from '../../../config/database.config';

/** Lead count by status */
export async function getContactStatusBreakdown(tenantId: string, assignedUserId?: string) {
  const groups = await prisma.lead.groupBy({
    by:    ['status'],
    where: { tenantId, isArchived: false, deletedAt: null, convertedAt: null, ...(assignedUserId ? { assignedUserId } : {}) },
    _count: { status: true },
  });
  return groups.map((g: { status: string; _count: { status: number } }) => ({
    status: g.status,
    count:  g._count.status,
  }));
}

/** Task completion stats */
export async function getTaskCompletion(tenantId: string, assignedUserId?: string) {
  const scope = { tenantId, isArchived: false, ...(assignedUserId ? { assignedUserId } : {}) };
  const [total, completed, overdue] = await Promise.all([
    prisma.task.count({ where: scope }),
    prisma.task.count({ where: { ...scope, status: 'completed' } }),
    prisma.task.count({ where: { ...scope, dueDate: { lt: new Date() }, status: { notIn: ['completed', 'cancelled'] } } }),
  ]);
  const pending = await prisma.task.count({ where: { ...scope, status: { notIn: ['completed', 'cancelled'] } } });
  return { total, completed, overdue, pending };
}

/** Campaign engagement summary */
export async function getCampaignSummary(tenantId: string) {
  const campaigns = await prisma.campaign.findMany({
    where:   { tenantId, isArchived: false },
    orderBy: { sentAt: 'desc' },
    take:    10,
    select: { id: true, name: true, type: true, status: true, sentCount: true, openedCount: true, clickedCount: true, engagement: true, sentAt: true },
  });
  return campaigns;
}
