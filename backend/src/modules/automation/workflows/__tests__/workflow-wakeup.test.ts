import { afterEach, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { salesContext, markWorkflowQueued, workflowTransactionCommitted } from '../../../crm/leads/sales-context';
import { crmActor } from '../../../crm/access/crm-record-access.service';
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), findWorkflow: vi.fn() }));
vi.mock('../../../../config/database.config', () => ({ default: {
  workflowExecutionRun: { findMany: mocks.findMany, updateMany: mocks.updateMany }, workflow: { findFirst: mocks.findWorkflow },
  $transaction: async (work: (tx: unknown) => unknown) => work({ workflowExecutionRun: { updateMany: mocks.updateMany }, workflowExecutionStep: { count: async () => 0 } }),
} }));
import { dispatchQueuedWorkflows, startWorkflowScheduler } from '../workflow-queue';

const committedWake = () => {
  const tx = {} as Parameters<typeof markWorkflowQueued>[0];
  markWorkflowQueued(tx);
  workflowTransactionCommitted(tx);
};

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('wakes before the recovery tick and keeps the worker outside the requesting transaction and actor', async () => {
  vi.useFakeTimers();
  const contexts: unknown[] = [];
  mocks.findMany.mockImplementation(async () => { contexts.push([salesContext.getStore(), crmActor.getStore()]); return []; });
  const stop = startWorkflowScheduler();
  await vi.waitFor(() => expect(mocks.findMany).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  salesContext.run({} as never, () => crmActor.run({ tenantId: 'tenant', userId: 'agent' }, committedWake));
  await vi.waitFor(() => expect(mocks.findMany.mock.calls.length).toBeGreaterThanOrEqual(4));
  expect(contexts.every(value => JSON.stringify(value) === '[null,null]')).toBe(true);
  await stop();
  const reads = mocks.findMany.mock.calls.length;
  committedWake(); await vi.advanceTimersByTimeAsync(60000);
  expect(mocks.findMany).toHaveBeenCalledTimes(reads);
});

it('defers a transiently failing batch so a later batch can progress without immediately retrying it', async () => {
  mocks.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(Array.from({ length: 10 }, (_, index) => ({
    id: `run-${index}`, tenantId: 'tenant', workflowId: 'workflow', dispatchContext: { version: 1 },
  })));
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findWorkflow.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('private database address', { code: 'P1001', clientVersion: '5' }));
  expect(await dispatchQueuedWorkflows()).toBe(true);
  expect(mocks.findWorkflow).toHaveBeenCalledTimes(10);
  expect(mocks.updateMany).toHaveBeenCalledTimes(20);
});
