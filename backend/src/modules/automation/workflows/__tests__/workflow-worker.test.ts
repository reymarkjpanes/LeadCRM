import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { tenantContext } from '../../../../core/tenant/tenant-context';
import { salesContext, markWorkflowQueued, workflowTransactionCommitted } from '../../../crm/leads/sales-context';
import { workflowLease } from '../workflow-dispatch-context';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), workflow: vi.fn(), admission: vi.fn(), transaction: vi.fn(), engine: vi.fn(), steps: vi.fn(), stepCount: vi.fn(), interrupt: vi.fn() }));
vi.mock('../../../../config/database.config', () => ({ default: {
  workflowExecutionRun: { findMany: mocks.findMany, updateMany: mocks.updateMany },
  workflow: { findFirst: mocks.workflow }, $transaction: mocks.transaction,
} }));
vi.mock('../workflow-fields', () => ({ accountWorkflowRetirementReferences: async () => [] }));
vi.mock('../workflows.repository', () => ({ entityContext: vi.fn() }));
vi.mock('../workflow-interruption', () => ({ interruptWorkflowRun: mocks.interrupt }));
vi.mock('../workflow.engine.js', () => ({ fireWorkflowTrigger: mocks.engine }));
import { dispatchQueuedWorkflows, startWorkflowScheduler } from '../workflow-queue';
import { workflowWorkerStatus } from '../workflow-worker-status';

let rows: any[];
let stop: (() => Promise<void>) | undefined;
const wake = () => {
  const tx = {} as Prisma.TransactionClient;
  markWorkflowQueued(tx); workflowTransactionCommitted(tx);
};
const run = (id: number) => ({ id: String(id), tenantId: 'tenant', workflowId: 'workflow', status: 'queued',
  leaseId: null, leaseUntil: null, dispatchStartedAt: null, definitionSnapshot: {},
  dispatchContext: { version: 1, activatedById: 'admin' }, trigger: { triggerType: 'deal.updated', eventId: String(id) } });

const transient = () => new Prisma.PrismaClientKnownRequestError('private database connection', { code: 'P1001', clientVersion: '5' });
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); rows = [];
  vi.setSystemTime(new Date('2026-11-11T00:00:00Z')); vi.spyOn(Math, 'random').mockReturnValue(0);
  mocks.findMany.mockImplementation(async ({ where, select }) => where.status === 'queued'
    ? rows.filter(row => row.status === 'queued' && row.dispatchContext && !row.dispatchStartedAt && (!row.leaseUntil || +row.leaseUntil <= Date.now())).slice(0, 10)
    : select ? rows.filter(row => row.dispatchContext && row.dispatchStartedAt && (row.status === 'running' && +row.leaseUntil < Date.now()
      || row.status === 'queued' && (!row.leaseId || !row.leaseUntil || +row.leaseUntil <= Date.now()))).slice(0, 50) : []);
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    const row = rows.find(row => row.id === where.id && (!where.status || (typeof where.status === 'string' ? row.status === where.status : row.status !== where.status.not))
      && (!where.leaseId || row.leaseId === where.leaseId)
      && (!where.OR || !row.leaseUntil || +row.leaseUntil <= Date.now())
      && (!where.leaseUntil?.gt || +row.leaseUntil > +where.leaseUntil.gt));
    if (!row) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
  mocks.steps.mockResolvedValue({ count: 1 });
  mocks.stepCount.mockResolvedValue(0);
  mocks.transaction.mockImplementation(work => work({ workflowExecutionRun: { updateMany: mocks.updateMany }, workflowExecutionStep: { createMany: mocks.steps, count: mocks.stepCount }, $queryRaw: mocks.admission }));
  mocks.interrupt.mockImplementation(async (_tx, item, where, _now, reason) => {
    const row = rows.find(row => row.id === item.id && (!where.leaseId || row.leaseId === where.leaseId) && row.status === where.status);
    if (!row) return false;
    Object.assign(row, { status: 'interrupted', completedAt: new Date(), leaseId: null, leaseUntil: null, errorMessage: reason }); return true;
  });
  mocks.admission.mockResolvedValue([{ id: 'workflow' }]);
  mocks.workflow.mockResolvedValue({ id: 'workflow', version: 1, isActive: true, status: 'ACTIVE' });
  mocks.engine.mockImplementation(async (_params, { run }) => { rows.find(row => row.id === run.id).status = 'completed'; });
});
afterEach(async () => { await stop?.(); stop = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

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
  mocks.workflow.mockRejectedValue(transient());
  stop = startWorkflowScheduler();
  await vi.waitFor(() => expect(mocks.workflow).toHaveBeenCalledTimes(10));
  expect(rows.every(row => row.status === 'queued' && !row.leaseId && +row.leaseUntil > Date.now())).toBe(true);
  mocks.workflow.mockResolvedValue({ id: 'workflow', version: 1, isActive: true, status: 'ACTIVE' });
  await vi.advanceTimersByTimeAsync(60000);
  await vi.waitFor(() => expect(mocks.engine).toHaveBeenCalledTimes(10));
});

it('drains a healthy eleventh run while the oldest ten are deferred', async () => {
  rows.push(...Array.from({ length: 10 }, (_, i) => ({ ...run(i), workflowId: 'failing' })), run(11));
  mocks.workflow.mockImplementation(async ({ where }) => {
    if (where.id === 'failing') throw transient();
    return { id: 'workflow', version: 1, isActive: true, status: 'ACTIVE' };
  });
  stop = startWorkflowScheduler();
  await vi.waitFor(() => expect(rows[10].status).toBe('completed'));
  expect(mocks.engine).toHaveBeenCalledOnce();
  expect(rows.slice(0, 10).every(row => row.status === 'queued' && +row.leaseUntil > Date.now())).toBe(true);
});

it('records a permanent preparation failure atomically with validation evidence and no raw error', async () => {
  rows.push(run(1)); mocks.workflow.mockRejectedValue(new TypeError('secret connection data'));
  await dispatchQueuedWorkflows();
  expect(rows[0]).toMatchObject({ status: 'failed', leaseId: null, leaseUntil: null, dispatchStartedAt: null });
  expect(rows[0].errorMessage).not.toContain('secret');
  expect(mocks.steps).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ actionType: 'validation', status: 'failed', stepIndex: -1 })] }));
  expect(mocks.engine).not.toHaveBeenCalled();
});

it('bounds known transient preparation failures to five claims and then fails without dispatch', async () => {
  rows.push(run(1)); mocks.workflow.mockRejectedValue(transient());
  for (let attempt = 1; attempt <= 5; attempt++) {
    await dispatchQueuedWorkflows();
    expect(rows[0].dispatchContext.preparation.attempts).toBe(attempt);
    if (attempt < 5) {
      expect(rows[0].status).toBe('queued');
      vi.setSystemTime(new Date(+rows[0].leaseUntil));
    }
  }
  expect(rows[0]).toMatchObject({ status: 'failed', leaseId: null, leaseUntil: null, dispatchStartedAt: null });
  expect(mocks.workflow).toHaveBeenCalledTimes(5); expect(mocks.steps).toHaveBeenCalledOnce();
  await dispatchQueuedWorkflows(); expect(mocks.workflow).toHaveBeenCalledTimes(5);
  expect(mocks.engine).not.toHaveBeenCalled();
});

it('counts a prior crash before admission and refuses a sixth preparation attempt', async () => {
  rows.push({ ...run(1), leaseId: 'crashed-worker', leaseUntil: new Date(Date.now() - 1),
    dispatchContext: { ...run(1).dispatchContext, preparation: { attempts: 5 } } });
  await dispatchQueuedWorkflows();
  expect(rows[0]).toMatchObject({ status: 'failed', dispatchStartedAt: null, dispatchContext: { preparation: { attempts: 5 } } });
  expect(mocks.engine).not.toHaveBeenCalled(); expect(mocks.workflow).not.toHaveBeenCalled();
});

it('allows one worker claim and dispatch when two workers discover the same run', async () => {
  rows.push(run(1)); await Promise.all([dispatchQueuedWorkflows(), dispatchQueuedWorkflows()]);
  expect(mocks.engine).toHaveBeenCalledOnce(); expect(rows[0].dispatchContext.preparation.attempts).toBe(1);
});

it('surfaces a rolled-back claim failure without inventing a persisted attempt or dispatching', async () => {
  rows.push(run(1)); const failure = transient(); mocks.transaction.mockRejectedValueOnce(failure);
  await expect(dispatchQueuedWorkflows()).rejects.toBe(failure);
  expect(rows[0]).toMatchObject({ status: 'queued', leaseId: null, leaseUntil: null, dispatchStartedAt: null });
  expect(rows[0].dispatchContext.preparation).toBeUndefined(); expect(mocks.engine).not.toHaveBeenCalled();
});

it('never turns a started action into a preparation retry even for a transient error', async () => {
  rows.push(run(1)); mocks.engine.mockRejectedValue(transient()); await dispatchQueuedWorkflows();
  expect(rows[0]).toMatchObject({ status: 'interrupted', leaseId: null, leaseUntil: null });
  expect(rows[0].dispatchStartedAt).toBeInstanceOf(Date);
  expect(mocks.interrupt).toHaveBeenCalledOnce(); expect(mocks.steps).not.toHaveBeenCalled();
});

it('does not overwrite a replacement worker claim when an old preparation fails', async () => {
  rows.push(run(1)); mocks.workflow.mockImplementation(async () => {
    Object.assign(rows[0], { leaseId: 'replacement-worker', leaseUntil: new Date(Date.now() + 300000), status: 'running', dispatchStartedAt: new Date() });
    throw transient();
  });
  await dispatchQueuedWorkflows();
  expect(rows[0]).toMatchObject({ status: 'running', leaseId: 'replacement-worker' });
  expect(mocks.steps).not.toHaveBeenCalled();
});

it.each([true, false])('quarantines prior queued steps before evaluating workflow active=%s', async isActive => {
  rows.push(run(1)); mocks.stepCount.mockResolvedValue(1);
  mocks.workflow.mockResolvedValue({ id: 'workflow', version: 1, isActive, status: isActive ? 'ACTIVE' : 'PAUSED' });
  await dispatchQueuedWorkflows();
  expect(rows[0]).toMatchObject({ status: 'interrupted', dispatchStartedAt: null, leaseId: null });
  expect(rows[0].errorMessage).toContain('prior action evidence');
  expect(mocks.workflow).not.toHaveBeenCalled(); expect(mocks.engine).not.toHaveBeenCalled();
});

it('quarantines a queued dispatch marker without consuming active claims or context-free historical rows', async () => {
  const marker = new Date(Date.now() - 60000);
  rows.push({ ...run(1), dispatchStartedAt: marker },
    { ...run(2), dispatchStartedAt: marker, leaseId: 'active', leaseUntil: new Date(Date.now() + 300000) },
    { ...run(3), dispatchStartedAt: marker, dispatchContext: null }, { ...run(4), dispatchContext: null });
  await dispatchQueuedWorkflows();
  expect(rows[0]).toMatchObject({ status: 'interrupted', dispatchStartedAt: marker });
  expect(rows.slice(1).every(row => row.status === 'queued')).toBe(true);
  expect(mocks.engine).not.toHaveBeenCalled(); expect(mocks.workflow).not.toHaveBeenCalled();
});

it('records successful and failed sweeps in process-local diagnostics', async () => {
  stop = startWorkflowScheduler();
  await vi.waitFor(() => expect(workflowWorkerStatus().lastSuccessfulSweepAt).not.toBeNull());
  mocks.findMany.mockRejectedValue(new Error('private failure'));
  await vi.advanceTimersByTimeAsync(30000);
  expect(workflowWorkerStatus()).toMatchObject({ scope: 'process', running: true, lastFailedSweepAt: expect.any(String) });
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
