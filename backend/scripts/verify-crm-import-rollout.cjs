const assert = require('node:assert/strict');

const routes = { LEAD: 'leads', CONTACT: 'contacts', ACCOUNT: 'accounts', DEAL: 'deals' };
const wire = value => JSON.parse(JSON.stringify(value));

/** Read-only verification. Tokens never leave this process or appear in reports. */
async function verifyImportRollout(db, apiUrl, tokens) {
  const base = new URL(apiUrl);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Verification requires HTTPS or a local disposable server.');
  const request = async (path, token) => {
    const response = await fetch(base.href.replace(/\/$/, '') + path, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Import verification HTTP ${response.status}; no retirement approved.`);
    return response.json();
  };
  return verifyRequests(db, tokens.map(token => path => request(path, token)));
}

async function verifyRequests(db, requests) {
  const counts = await db.$queryRawUnsafe('SELECT * FROM crm_verify_import_normalization()');
  const historicalTenants = await db.$queryRawUnsafe(`SELECT DISTINCT payload->>'tenantId' AS id FROM _crm_legacy_import_jobs`);
  const verified = new Set(), moduleChecks = [];
  for (const request of requests) {
    const user = (await request('/auth/me')).data.user;
    assert.equal(typeof user.tenantId, 'string');
    for (const [module, route] of Object.entries(routes)) {
      const jobs = await db.crmImportJob.findMany({ where: { tenantId: user.tenantId, module }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const seen = [];
      for (let page = 1; ; page++) {
        const response = await request(`/crm/${route}/imports?page=${page}&limit=100`);
        assert.equal(response.meta.total, jobs.length, 'History count mismatch');
        for (const job of response.data) {
          assert.equal(job.module, module, 'Module isolation mismatch'); seen.push(job.id);
        }
        if (!response.meta.hasMore) break;
      }
      assert.deepEqual(seen, jobs.map(j => j.id), 'History ID/order mismatch');
      for (const job of jobs) {
        const actual = (await request(`/crm/${route}/imports/${job.id}`)).data;
        for (const field of ['id', 'module', 'fileName', 'totalRecords', 'successfulRecords', 'failedRecords', 'duplicateRecords', 'status', 'createdAt', 'completedAt']) assert.deepEqual(actual[field], wire(job[field]), `History ${field} mismatch`);
        const expected = await db.crmImportRowResult.findMany({ where: { importJobId: job.id }, orderBy: { rowNumber: 'asc' } });
        const rows = [];
        for (let page = 1; ; page++) {
          const response = await request(`/crm/${route}/imports/${job.id}/results?page=${page}&limit=100`);
          assert.equal(response.meta.total, expected.length);
          rows.push(...response.data);
          if (!response.meta.hasMore) break;
        }
        assert.equal(rows.length, expected.length);
        rows.forEach((row, index) => {
          for (const field of ['id', 'importJobId', 'rowNumber', 'status', 'recordId', 'remarks', 'data', 'createdAt']) assert.deepEqual(row[field], wire(expected[index][field]), `Result ${field} mismatch`);
        });
      }
      // A successful new execution proves deployed code writes to the shared model.
      assert(jobs.some(j => j.idempotencyKey && j.completedAt && j.successfulRecords > 0), `Complete a ${route} import through the deployed service before retirement.`);
      moduleChecks.push({ module, jobs: jobs.length });
    }
    verified.add(user.tenantId);
  }
  const inactiveSandboxWorkspaces = await verifyWorkspaceCoverage(db, historicalTenants, verified);
  await db.$queryRawUnsafe('SELECT * FROM crm_verify_import_normalization()');
  return { historical: counts.map(c => ({ module: c.module, jobs: Number(c.jobs), results: Number(c.results) })), workspacesVerified: verified.size, inactiveSandboxWorkspaces, moduleChecks };
}

async function verifyWorkspaceCoverage(db, historicalTenants, verified) {
  const inactiveSandboxWorkspaces = [];
  for (const tenant of historicalTenants) {
    if (verified.has(tenant.id)) continue;
    // Dormant sandboxes cannot sign in. Their complete payloads are still checked
    // twice by SQL and again in the locked retirement transaction. Never exempt an
    // active workspace or a sandbox with any active user from API verification.
    const scope = await db.tenant.findUnique({ where: { id: tenant.id }, select: { status: true } });
    const activeUsers = await db.user.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } });
    assert(scope?.status === 'SANDBOX' && activeUsers === 0, 'An affected workspace has not passed authenticated History verification.');
    inactiveSandboxWorkspaces.push(tenant.id);
  }
  assert(verified.size > 0, 'Provide authenticated verification evidence.');
  return inactiveSandboxWorkspaces;
}
module.exports = { verifyImportRollout, verifyRequests, verifyWorkspaceCoverage };
