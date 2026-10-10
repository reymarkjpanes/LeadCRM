const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyRequests } = require('./verify-crm-import-rollout.cjs');
const { validatePages, verifyBrowserImportRollout } = require('./verify-crm-import-browser.cjs');
const base = 'https://crm.example';
const now = Date.now();
const entry = path => ({ url: base + path, capturedAt: new Date(now).toISOString(), text: 'Import history', tables:[[['Date'],['Oct 4']]] });
const evidence = pages => ({ version: 1, origin:base, workspaces: [{ tenantId:'active', pages }] });

test('browser evidence requires fresh import pages on the exact origin', () => {
  const page = entry('/crm/leads/import');
  validatePages(evidence([page]),base,now);
  for(const patch of [{capturedAt:new Date(now-1800001).toISOString()}, {url:'https://other.example/crm/leads/import'}, {text:'Import Not Found'}, {tables:[]}, {url:base+'/login'}]) {
    assert.throws(()=>validatePages(evidence([{...page,...patch}]),base,now));
  }
  assert.throws(()=>validatePages(evidence([page,page]),base,now));
});

function fixture(status, activeUsers) {
  const modules = { leads: 'LEAD', contacts: 'CONTACT', accounts: 'ACCOUNT', deals: 'DEAL' };
  const jobs = Object.values(modules).map(module => ({ id: module, module, tenantId: 'active', fileName: 'qa.csv', totalRecords: 1, successfulRecords: 1, failedRecords: 0, duplicateRecords: 0, status: 'completed', idempotencyKey: module, createdAt: '2026-10-04', completedAt: '2026-10-04' }));
  const db = {
    $queryRawUnsafe: async sql => sql.includes('DISTINCT') ? [{ id: 'active' }, { id: 'dormant' }] : [{ module: 'LEAD', jobs: 2, results: 8 }],
    tenant: { findUnique: async () => ({ status }) },
    user: { count: async () => activeUsers },
    crmImportJob: { findMany: async ({ where }) => jobs.filter(job => job.module === where.module) },
    crmImportRowResult: { findMany: async () => [] },
  };
  const request = async path => {
    if (path === '/auth/me') return { data: { user: { tenantId: 'active' } } };
    const module = modules[path.split('/')[2]];
    const job = jobs.find(job => job.module === module);
    if (path.includes('/results?')) return { data: [], meta: { total: 0, hasMore: false } };
    if (path.includes('/imports?')) return { data: [job], meta: { total: 1, hasMore: false } };
    return { data: job };
  };
  return { db, request, jobs };
}

test('only a sandbox with zero active users receives database-only historical verification', async () => {
  const valid = fixture('SANDBOX', 0);
  const report = await verifyRequests(valid.db, [valid.request]);
  assert.deepEqual(report.inactiveSandboxWorkspaces, ['dormant']);
  for (const [status, activeUsers] of [['ACTIVE', 0], ['SANDBOX', 1]]) {
    const invalid = fixture(status, activeUsers);
    await assert.rejects(verifyRequests(invalid.db, [invalid.request]));
  }
  await assert.rejects(verifyRequests(valid.db, []));
});

test('browser transport does not relax successful-import or exact history checks', async () => {
  const missing = fixture('SANDBOX', 0);
  missing.jobs[0].successfulRecords = 0;
  await assert.rejects(verifyRequests(missing.db, [missing.request]));
  const changed = fixture('SANDBOX', 0);
  await assert.rejects(verifyRequests(changed.db, [async path => {
    const result = await changed.request(path);
    if (path === '/crm/leads/imports/LEAD') return { data: { ...result.data, fileName: 'changed.csv' } };
    return result;
  }]));
});

test('UI verification compares every module history and every visible result cell', async () => {
  const {db,jobs} = fixture('SANDBOX',0);
  const columns = {
    LEAD:['First Name','Last Name','Email','Phone Number','Company Name','Full Address','Product Interest'],
    CONTACT:['First Name','Last Name','Email','Phone Number','Company Name','Full Address','Product Interest'],
    ACCOUNT:['Company Name','Product Interest','Industry','Website','Address','City'],
    DEAL:['Deal Title','Product Interest','Pipeline','Stage','Customer Email','Priority'],
  };
  const pages=[];
  for(const job of jobs) {
    job.createdBy={firstName:'Test',lastName:'Admin'};
    const route={LEAD:'leads',CONTACT:'contacts',ACCOUNT:'accounts',DEAL:'deals'}[job.module];
    pages.push({...entry(`/crm/${route}/import`),tables:[[
      ['Date','File Name','Status','Records','Failed / Duplicates','Imported By'],
      ['Oct 4, 2026, 08:00 AM','qa.csv','Success','1 / 1','0 / 0','Test Admin'],
    ]]});
    pages.push({...entry(`/crm/${route}/imports/${job.id}`),text:'Import Results qa.csv 1 / 1',tables:[[
      ['Row',...columns[job.module],'Status','Remarks'],
      ['2',...columns[job.module].map(()=> '—'),'Imported','Successfully imported'],
    ]]});
  }
  db.crmImportRowResult.findMany=async()=>[{rowNumber:2,status:'imported',data:{}}];
  const data=evidence(pages);
  assert.equal((await verifyBrowserImportRollout(db,base,data)).moduleChecks.length,4);
  const missing=structuredClone(data); missing.workspaces[0].pages.pop();
  await assert.rejects(verifyBrowserImportRollout(db,base,missing));
  const wrongRow=structuredClone(data); wrongRow.workspaces[0].pages[1].tables[0][1][1]='Wrong';
  await assert.rejects(verifyBrowserImportRollout(db,base,wrongRow));
  const wrongCount=structuredClone(data); wrongCount.workspaces[0].pages[0].tables[0][1][3]='2 / 2';
  await assert.rejects(verifyBrowserImportRollout(db,base,wrongCount));
});
