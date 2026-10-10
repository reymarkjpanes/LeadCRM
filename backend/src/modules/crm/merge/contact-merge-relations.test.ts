import { expect, it, vi } from 'vitest';
vi.mock('../../../config/database.config', () => ({ default: {} }));
vi.mock('../../operations/tasks/tasks.repository', () => ({ reassignTaskLinks: vi.fn().mockResolvedValue({ count: 1 }), taskAssociationWhere: vi.fn() }));
import { reassignContactRelationships } from './merge.repository';
it('preserves conversion, submissions, files and custom values while avoiding duplicate campaign recipients', async () => {
  const updateMany = () => vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    activity: { updateMany: updateMany() }, lead: { updateMany: updateMany() },
    formSubmission: { updateMany: updateMany() }, recordFile: { updateMany: updateMany() },
    contactDeal: { findMany: vi.fn().mockResolvedValue([]) },
    customFieldValue: { findMany: vi.fn().mockResolvedValue([{ fieldId: 'field', value: 'secondary value', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') }]), upsert: vi.fn() },
    campaignContact: { findMany: vi.fn().mockResolvedValue([{ campaignId: 'already-linked' }]), updateMany: updateMany() },
    emailDeliveryLog: { updateMany: updateMany() }, mailboxMessage: { updateMany: updateMany() }, emailAccount: { updateMany: updateMany() },
  };
  await reassignContactRelationships(tx as never, 'primary', 'secondary', 'tenant');
  for (const model of [tx.lead, tx.formSubmission, tx.recordFile, tx.emailDeliveryLog, tx.mailboxMessage]) {
    expect(model.updateMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', contactId: 'secondary' }, data: { contactId: 'primary' } });
  }
  expect(tx.customFieldValue.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { tenantId_fieldId_contactId: { tenantId: 'tenant', fieldId: 'field', contactId: 'primary' } }, update: {},
    create: expect.objectContaining({ module: 'contacts', contactId: 'primary', value: 'secondary value' }),
  }));
  expect(tx.campaignContact.updateMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', contactId: 'secondary', campaignId: { notIn: ['already-linked'] } }, data: { contactId: 'primary' } });
  expect(tx.emailAccount.updateMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant', messages: { some: { tenantId: 'tenant', contactId: 'primary' } } }, data: { mailboxVersion: { increment: 1 } } });
});
