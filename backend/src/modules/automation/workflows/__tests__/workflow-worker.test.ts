import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { salesContext, markWorkflowQueued, workflowTransactionCommitted } from '../../../crm/leads/sales-context';
import { workflowLease } from '../workflow-dispatch-context';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), workflow: vi.fn(), admission: vi.fn(), transaction: vi.fn(), engine: vi.fn() }));
vi.mock('../../../../config/database.config', () => ({ default: {
  workflowExecutionRun: { findMany: mocks.findMany, updateMany: mocks.updateMany },
  workflow: { findFirst: mocks.workflow }, $transaction: mocks.transaction,
} }));
vi.mock('../workflow-fields', () => ({ accountWorkflowRetirementReferences: async () => [] }));
vi.mock('../workflows.repository', () => ({ entityContext: vi.fn() }));
vi.mock('../workflow-interruption', () => ({ interruptWorkflowRun: vi.fn() }));
vi.mock('../workflow.engine.js', () => ({ fireWorkflowTrigger: mocks.engine }));
import { startWorkflowScheduler } from '../workflow-queue';

let rows: any[];
let stop: (() => Promise<void>) | undefined;
const wake = () => {
  const tx = {} as Prisma.TransactionClient;
  markWorkflowQueued(tx); workflowTransactionCommitted(tx);
};
const run = (id: number) => ({ id: String(id), tenantId: 'tenant', workflowId: 'workflow', status: 'queued',
  leaseId: null, dispatchStartedAt: null, definitionSnapshot: {},
  dispatchContext: { version: 1, activatedById: 'admin' }, trigger: { triggerType: 'deal.updated', eventId: String(id) } });

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); rows = [];
  mocks.findMany.mockImplementation(async ({ where }) => where.status === 'queued' ? rows.filter(row => row.status === 'queued' && !row.leaseId).slice(0, 10) : []);
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    const row = rows.find(row => row.id === where.id && (!where.status || typeof where.status !== 'string' || row.status === where.status));
    if (!row) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  mocks.transaction.mockImplementation(work => work({ workflowExecutionRun: { updateMany: mocks.updateMany }, $queryRaw: mocks.admission }));
  mocks.admission.mockResolvedValue([{ id: 'workflow' }]);
  mocks.workflow.mockResolvedValue({ id: 'workflow', version: 1, isActive: true, status: 'ACTIVE' });
  mocks.engine.mockImplementation(async (_params, { run }) => { rows.find(row => row.id === run.id).status = 'completed'; });
});
afterEach(async () => { await stop?.(); stop = undefined; vi.useRealTimers(); });

it('dispatches a committed wake immediately in startup context, coalescing concurrent wakes', async () => {
  stop = startWorkflowScheduler();
  await vi.waitFor(() => expect(mocks.findMany).toHaveBeenCalledTimes(2));
  mocks.findMany.mockImplementation(async ({ where }) => {
    expect(tenantContext.getStore()).toBeUndefined(); expect(salesContext.getStore()).toBeUndefined(); expect(workflowLease.getStore()).toBeUndefined();
    return where.status === 'queued' ? rows.filter(row => row.status === 'queued') : [];
  });
  rows.push(run(1));
  tenantContext.run({ tenantId: 'request' }, () => salesContext.run({} as never, () => workflowLease.run({ tenantId: 'request', executionId: 'old', leaseId: 'old' }, () => { wake(); wake(); wake(); })));
  await vi.waitFor(() => expect(mocks.engine).toHaveBeenCalledOnce());
  expect(rows[0].status).toBe('completed');
  expect(mocks.findMany).toHaveBeenCalledTimes(4);
});

it('retains a wake arriving during dispatch and drains more than ten records', async () => {
  rows.push(...Array.from({ length: 23 }, (_, i) => run(i)));
  let release!: () => void;
  mocks.engine.mockImplementationOnce(async (_params, { run }) => {
    await new Promise<void>(resolve => { release = resolve; }); rows.find(row => row.id === run.id).status = 'completed';
  });
  stop = startWorkflowScheduler();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  rows.push(run(24)); wake(); release();
  await vi.waitFor(() => expect(rows.every(row => row.status === 'completed')).toBe(true));
  expect(mocks.engine).toHaveBeenCalledTimes(24);
});

it('leaves repeated preparation failures for the scheduled recovery tick', async () => {
  rows.push(...Array.from({ length: 10 }, (_, i) => run(i)));
  mocks.workflow.mockRejectedValue(new Error('temporary preparation failure'));
  stop = startWorkflowScheduler();
  await vi.waitFor(() => expect(mocks.workflow).toHaveBeenCalledTimes(10));
  expect(rows.every(row => row.status === 'queued' && !row.leaseId)).toBe(true);
  mocks.workflow.mockResolvedValue({ id: 'workflow', version: 1, isActive: true, status: 'ACTIVE' });
  await vi.advanceTimersByTimeAsync(30000);
  await vi.waitFor(() => expect(mocks.engine).toHaveBeenCalledTimes(10));
});

it('skips the queued run when pause wins the dispatch admission race', async () => {
  rows.push(run(1));
  // Discovery saw Active, but the transaction's locking read sees Paused.
  mocks.admission.mockResolvedValue([]);
  stop = startWorkflowScheduler();
  await vi.waitFor(() => expect(rows[0]).toMatchObject({ status: 'skipped', leaseId: null, dispatchStartedAt: null }));
  expect(mocks.engine).not.toHaveBeenCalled();
});

it('waits for active dispatch on shutdown and ignores later committed wakes', async () => {
  rows.push(run(1)); let release!: () => void;
  mocks.engine.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); });
  stop = startWorkflowScheduler(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  let stopped = false; const stopping = stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  wake(); release(); await stopping; stop = undefined;
  const calls = mocks.findMany.mock.calls.length; wake(); await Promise.resolve();
  expect(mocks.findMany).toHaveBeenCalledTimes(calls);
});
