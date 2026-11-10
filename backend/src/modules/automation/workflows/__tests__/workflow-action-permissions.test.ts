import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowDraft } from '@leadcrm/shared';

const mocks = vi.hoisted(() => ({ user: vi.fn(), template: vi.fn(), permissions: vi.fn() }));
vi.mock('../../actions/actions.repository', () => ({ findUser: mocks.user, findTemplate: mocks.template }));
vi.mock('../../../../core/permissions/permission.service', () => ({ assertPermissions: mocks.permissions }));
vi.mock('../../../../config/database.config', () => ({ default: {} }));
import { assertWorkflowPermissions } from '../../actions/action-permissions';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: 'publisher', role: 'Custom publisher' });
  mocks.template.mockResolvedValue({ subject: 'Fixture', body: '<p>Fixture</p>' });
});

it.each([
  ['lead.created', 'record', 'leads'],
  ['contact.created', 'record', 'contacts'],
  ['deal.created', 'primary_lead', 'leads'],
  ['deal.created', 'primary_contact', 'contacts'],
])('uses the actual SMS recipient module for %s / %s', async (trigger, recipient, module) => {
  const db = {};
  await assertWorkflowPermissions({ name: 'SMS', trigger, isActive: false,
    actions: [{ type: 'send_sms', config: { recipient, message: 'Fixture notification' } }],
  } as WorkflowDraft, 'tenant', 'publisher', 'workflows.activate', db as never);
  const required = mocks.permissions.mock.calls[0][1] as string[];
  expect(required).toContain('campaigns.send');
  expect(required).toContain(`${module}.view`);
  expect(required).toContain(`${module}.edit`);
  expect(required).not.toContain(`${module === 'leads' ? 'contacts' : 'leads'}.edit`);
  expect(mocks.permissions).toHaveBeenCalledWith({ tenantId: 'tenant', userId: 'publisher', role: 'Custom publisher' }, required, db);
});

it('reads the current publisher, template and grants through the admission transaction', async () => {
  const db = {};
  await assertWorkflowPermissions({ name: 'Email', trigger: 'lead.created', isActive: false,
    actions: [{ type: 'send_email', config: { recipient: 'record', templateId: 'template' } }],
  }, 'tenant', 'publisher', 'workflows.activate', db as never);
  expect(mocks.user).toHaveBeenCalledWith('publisher', 'tenant', db);
  expect(mocks.template).toHaveBeenCalledWith('template', 'tenant', db);
  expect(mocks.permissions.mock.calls[0][2]).toBe(db);
});

it('rejects a publisher that became unavailable before final admission', async () => {
  mocks.user.mockResolvedValue(null);
  await expect(assertWorkflowPermissions({ name: 'Email', trigger: 'lead.created', isActive: false,
    actions: [{ type: 'send_email', config: { recipient: 'record', subject: 'Fixture', body: 'Fixture' } }],
  }, 'tenant', 'publisher', 'workflows.activate', {} as never)).rejects.toMatchObject({ statusCode: 403 });
  expect(mocks.permissions).not.toHaveBeenCalled();
});
