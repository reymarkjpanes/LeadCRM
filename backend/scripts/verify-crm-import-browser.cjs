const assert = require('node:assert/strict');
const { verifyWorkspaceCoverage } = require('./verify-crm-import-rollout.cjs');
const routes = { LEAD: 'leads', CONTACT: 'contacts', ACCOUNT: 'accounts', DEAL: 'deals' };
const labels = { firstName: 'First Name', lastName: 'Last Name', email: 'Email', phone: 'Phone Number', companyName: 'Company Name', address: 'Full Address', productInterest: 'Product Interest' };
const fields = {
  LEAD: Object.entries(labels), CONTACT: Object.entries(labels),
  ACCOUNT: [['name','Company Name'],['productInterest','Product Interest'],['industry','Industry'],['website','Website'],['address','Address'],['city','City']],
  DEAL: [['title','Deal Title'],['productInterest','Product Interest'],['pipeline','Pipeline'],['stage','Stage'],['customer','Customer Email'],['priority','Priority']],
};
const normalize = value => String(value).replace(/\s+/g, ' ').trim();
const badges = { completed:'Success', completed_with_errors:'Partial', failed:'Failed', pending:'In Progress', importing:'In Progress' };
const date = value => new Date(value).toLocaleDateString('en-US', { timeZone:'Asia/Manila', month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });

// Operator-collected DOM evidence is an alternative transport, not authentication
// bypass: capture it from the signed-in production UI, never construct it from DB
// data. No cookies/tokens are exported. SQL still proves every historical payload.
function validatePages(evidence, origin, now = Date.now()) {
  assert.equal(new URL(origin).protocol, 'https:');
  assert.equal(new URL(origin).origin, origin);
  assert.equal(evidence.origin, origin);
  assert.equal(evidence.version, 1);
  assert(evidence.workspaces?.length > 0);
  for (const workspace of evidence.workspaces) {
    assert.equal(typeof workspace.tenantId, 'string');
    assert(workspace.pages.length > 0);
    const urls = new Set();
    for (const page of workspace.pages) {
      const url = new URL(page.url), age = now - Date.parse(page.capturedAt);
      assert.equal(url.origin, origin);
      assert(/^\/crm\/(leads|contacts|accounts|deals)\/imports?(?:\/[^/]+)?$/.test(url.pathname));
      assert(!url.search && !url.hash);
      assert(Number.isFinite(age) && age >= 0 && age <= 30 * 60 * 1000, 'Browser evidence is stale');
      assert(!urls.has(page.url), 'Duplicate page evidence'); urls.add(page.url);
      assert(page.tables?.length === 1 && page.tables[0].length > 1, 'Missing rendered import table');
      assert(!/Import Not Found|Failed to load import|No results found/.test(page.text));
    }
  }
}

async function verifyBrowserImportRollout(db, origin, evidence) {
  validatePages(evidence, origin);
  const counts = await db.$queryRawUnsafe('SELECT * FROM crm_verify_import_normalization()');
  const historicalTenants = await db.$queryRawUnsafe(`SELECT DISTINCT payload->>'tenantId' AS id FROM _crm_legacy_import_jobs`);
  const verified = new Set(), moduleChecks = [];
  for (const workspace of evidence.workspaces) {
    const tenantId = workspace.tenantId;
    assert(!verified.has(tenantId));
    const pages = new Map(workspace.pages.map(p => [new URL(p.url).pathname, p]));
    const table = (path, heading) => {
      const page = pages.get(path);
      assert(page && page.text.includes(heading), 'Missing UI verification page');
      return page.tables[0].map(row => row.map(normalize));
    };
    for (const [module, route] of Object.entries(routes)) {
      const jobs = await db.crmImportJob.findMany({ where:{tenantId,module}, orderBy:[{createdAt:'desc'},{id:'desc'}], include:{createdBy:{select:{firstName:true,lastName:true}}} });
      // This small-rollout path intentionally refuses pagination. Larger histories
      // must use the paginated bearer-token verifier, not partial screenshots.
      assert(jobs.length > 0 && jobs.length <= 10, 'Use paginated API verification for larger histories');
      assert(jobs.some(j => j.idempotencyKey && j.completedAt && j.successfulRecords > 0));
      const history = table(`/crm/${route}/import`, 'Import history');
      assert.deepEqual(history[0], ['Date','File Name','Status','Records','Failed / Duplicates','Imported By']);
      assert.deepEqual(history.slice(1), jobs.map(j => [date(j.createdAt),j.fileName,badges[j.status] || j.status,`${j.successfulRecords} / ${j.totalRecords}`,`${j.failedRecords} / ${j.duplicateRecords}`,`${j.createdBy.firstName} ${j.createdBy.lastName}`].map(normalize)), 'History mismatch');
      for (const job of jobs) {
        const path = `/crm/${route}/imports/${job.id}`, page = pages.get(path);
        const rows = await db.crmImportRowResult.findMany({where:{importJobId:job.id},orderBy:{rowNumber:'asc'}});
        assert(rows.length > 0 && rows.length <= 25, 'Use paginated API verification for larger result sets');
        const actual = table(path, 'Import Results');
        assert(normalize(page.text).includes(normalize(job.fileName)));
        assert(normalize(page.text).includes(`${job.successfulRecords} / ${job.totalRecords}`));
        assert.deepEqual(actual[0], ['Row',...fields[module].map(([,label]) => label),'Status','Remarks']);
        const expected = rows.map(row => {
          const data = row.data || {};
          const status = row.status === 'imported' ? 'Imported' : row.status === 'duplicate' ? 'Duplicate' : 'Failed';
          const remarks = row.status === 'imported' ? 'Successfully imported' + (data.resolvedValue === undefined ? '' : ' · Product value: ₱' + Number(data.resolvedValue).toLocaleString('en-PH')) : row.remarks || '—';
          return [row.rowNumber,...fields[module].map(([key]) => data[key] || '—'),status,remarks].map(normalize);
        });
        assert.deepEqual(actual.slice(1), expected, 'Visible row results mismatch');
      }
      moduleChecks.push({module,jobs:jobs.length});
    }
    verified.add(tenantId);
  }
  const inactiveSandboxWorkspaces = await verifyWorkspaceCoverage(db,historicalTenants,verified);
  await db.$queryRawUnsafe('SELECT * FROM crm_verify_import_normalization()');
  return {transport:'authenticated-browser-ui',historical:counts.map(c=>({module:c.module,jobs:Number(c.jobs),results:Number(c.results)})),workspacesVerified:verified.size,inactiveSandboxWorkspaces,moduleChecks};
}
module.exports = { validatePages, verifyBrowserImportRollout };
