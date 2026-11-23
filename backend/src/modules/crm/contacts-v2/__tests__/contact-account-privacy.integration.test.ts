import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import prisma from '../../../../config/database.config';
import { issueAuthSession } from '../../../../core/auth/auth-session';
import app from '../../../../app';

vi.mock('../../../../shared/services/email.service', () => ({ sendMail: vi.fn().mockResolvedValue({ submitted: true }) }));
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
const disposable = ['localhost', '127.0.0.1'].includes(url.hostname) && (url.pathname === '/leadcrm_forms_test_2' || /^\/leadcrm_sales_test_\d+$/.test(url.pathname));
describe.skipIf(!disposable)('Contact Account metadata privacy on authenticated HTTP', { timeout: 30000 }, () => {
  let tenantId: string, token: string, roleId: string, actorId: string, base: string, server: Server;
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: 'Contact Account privacy', slug: randomUUID(), status: 'ACTIVE', onboardingStep: 3, onboardingCompletedAt: new Date() } })).id;
    const role = await prisma.roleDefinition.create({ data: { tenantId, name: 'Contact intake only' } });
    roleId = role.id;
    await prisma.rolePermission.createMany({ data: ['contacts', 'leads', 'deals'].map(module => ({ tenantId, roleId, module, canView: true, canViewAll: true, canCreate: true, canEdit: true })) });
    const actor = await prisma.user.create({ data: { tenantId, firstName: 'Intake', lastName: 'Employee', email: `${randomUUID()}@camxian.com`, role: role.name,
      mustChangePassword: false, onboardingCompletedAt: new Date(), emailVerified: new Date(), userRoles: { create: { roleId } } } });
    actorId = actor.id;
    token = (await issueAuthSession(actor)).token;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  }, 30000);
  afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await prisma.$disconnect(); });

  it('persists companyName through authenticated create/edit/list/detail and rejects legacy company writes', async () => {
    const input = {requestId:randomUUID(),firstName:'Rename',lastName:'Contact',email:`${randomUUID()}@example.test`,companyName:`Company ${randomUUID()}`,assignedUserId:actorId};
    for (const extra of [{company:'Legacy'}, {company:'Legacy',companyName:'New'}]) {
      expect((await request('/crm/contacts','POST',{...input,...extra})).status).toBe(400);
    }
    expect(await prisma.contact.count({where:{tenantId,email:input.email}})).toBe(0);
    const created = await request('/crm/contacts','POST',input);
    expect(created.status,JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.companyName).toBe(input.companyName);
    expect(created.body.data).not.toHaveProperty('company');
    for (const extra of [{company:'Legacy'}, {company:'Legacy',companyName:'New'}]) {
      expect((await request(`/crm/contacts/${id}`,'PUT',extra)).status).toBe(400);
    }
    expect((await prisma.contact.findUniqueOrThrow({where:{id}})).companyName).toBe(input.companyName);
    const updated = await request(`/crm/contacts/${id}`,'PUT',{companyName:'Edited Ñ Company'});
    expect(updated.status,JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data).toMatchObject({id,companyName:'Edited Ñ Company',accountId:null});
    expect(updated.body.data).not.toHaveProperty('company');
    expect((await request(`/crm/contacts/${id}`)).body.data.companyName).toBe('Edited Ñ Company');
    const list = await request('/crm/contacts?search=Edited&sort=companyName:asc');
    expect(list.body.data.find((row:{id:string})=>row.id===id)).toMatchObject({companyName:'Edited Ñ Company'});
    expect(list.body.data.every((row:Record<string,unknown>)=>!('company' in row))).toBe(true);
    await request(`/crm/contacts/${id}`,'PUT',{companyName:''});
    expect((await prisma.contact.findUniqueOrThrow({where:{id}})).companyName).toBe('');
  });

  it('requires current Accounts View for new selections and hides nested names/search after revocation while retaining historical IDs', async () => {
    const secret = `Account-secret-${randomUUID()}`;
    const account = await prisma.account.create({ data: { tenantId, name: secret } });
    const replacement = await prisma.account.create({ data: { tenantId, name: `Other-secret-${randomUUID()}` } });
    expect((await request(`/crm/accounts/${account.id}`)).status).toBe(403);
    const rejectedInput = { requestId: randomUUID(), firstName: 'Rejected', lastName: 'Selection', email: `${randomUUID()}@example.test`, accountId: account.id };
    const rejected = await request('/crm/contacts', 'POST', rejectedInput);
    expect.soft(rejected.status, JSON.stringify(rejected.body)).toBe(403);
    expect.soft(await prisma.contact.count({ where: { tenantId, email: rejectedInput.email } })).toBe(0);
    expect.soft(await prisma.contactCreationReceipt.count({ where: { tenantId, requestId: rejectedInput.requestId } })).toBe(0);

    const accountsGrant = await prisma.rolePermission.create({ data: { tenantId, roleId, module: 'accounts', canView: true, canViewAll: true } });
    const input = { requestId: randomUUID(), firstName: 'Retained', lastName: 'Contact', email: `${randomUUID()}@example.test`, companyName: 'Public Contact company', accountId: account.id, assignedUserId: actorId };
    const created = await request('/crm/contacts', 'POST', input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.account).toMatchObject({ id: account.id, name: secret });
    expect(created.body.data.companyName).toBe(secret);
    expect(created.body.data).not.toHaveProperty('companyFromAccount');
    const lead = await request('/crm/leads', 'POST', { requestId: randomUUID(), firstName: 'Linked', lastName: 'Lead', email: `${randomUUID()}@example.test`, accountId: account.id, assignedUserId: actorId });
    expect(lead.status, JSON.stringify(lead.body)).toBe(201);
    expect(lead.body.data.companyName).toBe(secret);
    const allowedSearch = await request(`/crm/contacts?search=${encodeURIComponent(secret)}`);
    expect(allowedSearch.status).toBe(200); expect(allowedSearch.body.data.some((row: { id: string }) => row.id === id)).toBe(true);
    await prisma.rolePermission.delete({ where: { id: accountsGrant.id } });
    expect((await request(`/crm/accounts/${account.id}`)).status).toBe(403);

    const detail = await request(`/crm/contacts/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ id, accountId: account.id, companyName: null, firstName: input.firstName });
    expect(await prisma.contact.findUniqueOrThrow({ where: { id } })).toMatchObject({ companyName: secret, companyFromAccount: true });
    const leadDetail = await request(`/crm/leads/${lead.body.data.id}`);
    expect(leadDetail.status).toBe(200); expect(leadDetail.body.data.companyName).toBeNull();
    expect(leadDetail.body.data).not.toHaveProperty('companyFromAccount');
    expect((await request(`/crm/leads?search=${encodeURIComponent(secret)}`)).body.meta.total).toBe(0);
    const converted = await request(`/crm/leads/${lead.body.data.id}/convert`, 'POST', { skipAccountCreation: true });
    expect(converted.status, JSON.stringify(converted.body)).toBe(403);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.body.data.id } })).toMatchObject({ convertedAt: null, contactId: null });
    expect(await prisma.contact.count({ where: { tenantId, email: lead.body.data.email } })).toBe(0);
    expect.soft(detail.body.data.account).toBeNull();
    await prisma.rolePermission.create({ data: { tenantId, roleId, module: 'campaigns', canView: true } });
    const companies = await request('/marketing/audiences/companies?source=CONTACTS');
    expect(companies.status, JSON.stringify(companies.body)).toBe(200);
    expect(companies.body.data).not.toContain(secret);
    const preview = await request('/marketing/audiences/preview', 'POST', { source: 'CONTACTS', conditions: [{ field: 'companyName', operator: 'equals', value: secret }] });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(JSON.stringify(preview.body)).not.toContain(secret);
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Private Account relationships' } });
    const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Open', order: 0, requiredFields: [] } });
    const deal = await prisma.deal.create({ data: { tenantId, title: 'Public opportunity', pipelineId: pipeline.id, stageId: stage.id, accountId: account.id, assignedUserId: actorId,
      productInterests: [], tags: [] } });
    await prisma.contactDeal.create({ data: { tenantId, contactId: id, dealId: deal.id } });
    const dealDetail = await request(`/crm/deals/${deal.id}`);
    expect(dealDetail.status, JSON.stringify(dealDetail.body)).toBe(200);
    expect(dealDetail.body.data.organization).toBeNull();
    expect(dealDetail.body.data.contact.companyName).toBeNull();
    expect(JSON.stringify(dealDetail.body)).not.toContain(secret);
    expect((await request(`/crm/deals?search=${encodeURIComponent(secret)}`)).body.meta.total).toBe(0);
    const listed = await request(`/crm/contacts?search=${encodeURIComponent(input.firstName)}`);
    expect(listed.status).toBe(200); expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].accountId).toBe(account.id);
    expect.soft(listed.body.data[0].account).toBeNull();
    const deniedSearch = await request(`/crm/contacts?search=${encodeURIComponent(secret)}`);
    expect(deniedSearch.status).toBe(200);
    expect.soft(deniedSearch.body.data).toEqual([]); expect.soft(deniedSearch.body.meta.total).toBe(0);
    const replay = await request('/crm/contacts', 'POST', input);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.data.id).toBe(id); expect(replay.body.data.accountId).toBe(account.id);
    expect.soft(replay.body.data.account).toBeNull();
    const edit = await request(`/crm/contacts/${id}`, 'PUT', { notes: 'Unrelated edit remains permitted', accountId: account.id });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.data).toMatchObject({ id, accountId: account.id, notes: 'Unrelated edit remains permitted', companyName: null });
    expect.soft(edit.body.data.account).toBeNull();
    const changed = await request(`/crm/contacts/${id}`, 'PUT', { accountId: replacement.id, notes: 'Must roll back with rejected association' });
    expect.soft(changed.status, JSON.stringify(changed.body)).toBe(403);
    expect.soft(await prisma.contact.findUniqueOrThrow({ where: { id } })).toMatchObject({ accountId: account.id, notes: 'Unrelated edit remains permitted' });
    const unlinked = await request(`/crm/contacts/${id}`, 'PUT', { accountId: null });
    expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id } })).accountId).toBeNull();
    expect(unlinked.body.data.account).toBeNull();
    expect(unlinked.body.data.companyName).toBeNull();
    expect((await request(`/crm/contacts?search=${encodeURIComponent(secret)}`)).body.meta.total).toBe(0);
    const independent = await request('/crm/contacts', 'POST', { ...input, requestId: randomUUID(), email: `${randomUUID()}@example.test`, accountId: undefined });
    expect(independent.status, JSON.stringify(independent.body)).toBe(201);
    expect(independent.body.data.companyName).toBe(input.companyName);
    expect((await request(`/crm/contacts?search=${encodeURIComponent(input.companyName)}`)).body.data.some((row: { id: string }) => row.id === independent.body.data.id)).toBe(true);

    await prisma.rolePermission.create({ data: { tenantId, roleId, module: 'accounts', canView: true, canViewAll: true } });
    const authorizedChange = await request(`/crm/contacts/${id}`, 'PUT', { accountId: replacement.id });
    expect(authorizedChange.status, JSON.stringify(authorizedChange.body)).toBe(200);
    expect(authorizedChange.body.data.account).toMatchObject({ id: replacement.id, name: replacement.name });
    expect((await request(`/crm/contacts/${id}`, 'PUT', { accountId: null })).status).toBe(200);
  });

  it('sorts by the current Account name before pagination and preserves historical Deal links', async () => {
    const prefix = 'Linked sorting';
    const original = await prisma.account.create({ data: { tenantId, name: 'Zulu Company' } });
    const middle = await prisma.account.create({ data: { tenantId, name: 'Middle Company' } });
    const archived = await prisma.account.create({ data: { tenantId, name: 'Archived Company', isArchived: true } });
    const foreign = await prisma.tenant.create({ data: { name: 'Foreign Account', slug: randomUUID() } });
    const foreignAccount = await prisma.account.create({ data: { tenantId: foreign.id, name: 'Foreign Company' } });
    const create = (accountId: string) => request('/crm/contacts', 'POST',
      { requestId: randomUUID(), firstName: 'Linked', lastName: 'Sorting', email: `${randomUUID()}@example.test`, accountId, assignedUserId: actorId });
    const first = await create(original.id);
    const second = await create(middle.id);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const { id } = first.body.data;
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: 'Historical Account links' } });
    const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: 'Open', order: 0 } });
    const deal = await prisma.deal.create({ data: { tenantId, stageId: stage.id, pipelineId: pipeline.id, accountId: original.id,
      title: 'Historical Deal', contactDeals: { create: { contactId: id } } } });
    await prisma.account.update({ where: { id: original.id }, data: { name: 'Alpha Company' } });
    for (const [page, expectedId, name] of [[1, id, 'Alpha Company'], [2, second.body.data.id, 'Middle Company']] as const) {
      const result = await request(`/crm/contacts?search=${encodeURIComponent(prefix)}&sort=companyName:asc&limit=1&page=${page}`);
      expect(result.body.data).toMatchObject([{ id: expectedId, companyName: name }]);
    }
    expect((await request(`/crm/contacts/${id}`)).body.data.companyName).toBe('Alpha Company');
    const oldNameSearch = await request('/crm/contacts?search=Zulu');
    expect(oldNameSearch.body.data).toMatchObject([{ id, companyName: 'Alpha Company' }]);
    for (const input of [{ accountId: archived.id }, { accountId: foreignAccount.id }, { companyName: 'Independent edit' }]) {
      expect((await request(`/crm/contacts/${id}`, 'PUT', input)).status).toBe(400);
    }
    const relink = await request(`/crm/contacts/${id}`, 'PUT', { accountId: middle.id });
    expect(relink.body.data).toMatchObject({ accountId: middle.id, companyName: middle.name });
    const clear = await request(`/crm/contacts/${id}`, 'PUT', { accountId: null });
    expect(clear.body.data).toMatchObject({ accountId: null, companyName: null });
    expect(await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).toMatchObject({ accountId: original.id });
    expect(await prisma.contactDeal.count({ where: { tenantId, dealId: deal.id, contactId: id } })).toBe(1);
  });
});
