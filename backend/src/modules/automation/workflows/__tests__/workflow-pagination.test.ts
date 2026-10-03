import { expect, it, vi } from 'vitest';
vi.mock('../../../../config/database.config', () => ({ default: {
  workflow: { findMany: vi.fn(async () => []), count: vi.fn(async () => 42) },
  workflowExecutionRun: { groupBy: vi.fn(async () => []) },
} }));
import prisma from '../../../../config/database.config';
import { listWorkflows } from '../workflows.repository';
it('applies all selected filters and tenant scope to both count and page queries', async () => {
  const result = await listWorkflows('tenant-a', { page: 2, limit: 20, status: 'ACTIVE,DRAFT', trigger: 'lead.created,contact.created', search: 'Follow' });
  const where = { tenantId: 'tenant-a', isArchived: false, status: { in: ['ACTIVE', 'DRAFT'] }, trigger: { in: ['lead.created', 'contact.created'] }, name: { contains: 'Follow', mode: 'insensitive' } };
  expect(prisma.workflow.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 20, take: 20 }));
  expect(prisma.workflow.count).toHaveBeenCalledWith({ where });
  expect(result.total).toBe(42);
});
