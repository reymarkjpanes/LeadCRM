// Retirement runs only after the serving backend reports the exact reviewed build,
// and authenticated list endpoints succeed against the expanded database.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { migrate } = require('./deploy-crm-imports.cjs');
const retirement = '20261102000000_retire_relationship_compatibility';
const fail = code => { throw Object.assign(new Error(code), { code }); };
async function verifyCanonicalRelease({ api, commit, token }, request = fetch) {
  if (!api || !/^[a-f0-9]{40}$/.test(commit || '') || !token) fail('CANONICAL_RELEASE_CONFIGURATION_REQUIRED');
  const url = new URL(api);
  if (url.protocol !== 'https:' || url.username || url.password) fail('HTTPS_API_REQUIRED');
  const base = api.replace(/\/$/, '');
  const get = async path => {
    // The frontend proxy forwards its same-origin HttpOnly cookie, not Bearer headers.
    const response = await request(base + path, { headers: { Authorization: `Bearer ${token}`, Cookie: `leadcrm_token=${token}`, 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) fail('CANONICAL_API_CHECK_FAILED');
    return response.json();
  };
  const health = await get('/health');
  if (health.commit !== commit || !health.capabilities?.includes('canonical-crm-relations-v1')) fail('CANONICAL_RELEASE_NOT_SERVING');
  const me = await get('/auth/me');
  const user = me.data?.user ?? me.data;
  if (!user?.id || !user?.tenantId || user.role !== 'Client Admin') fail('CANONICAL_ADMIN_VERIFICATION_REQUIRED');
  for (const path of ['/crm/deals?page=1&limit=2', '/operations/tasks?page=1&limit=2']) await get(path);
  return { commit, tenantId: user.tenantId, userId: user.id, capability: 'canonical-crm-relations-v1' };
}
async function main() {
  if (process.argv[2] !== '--retire' && process.argv[2] !== '--verify') fail('INVALID_MODE');
  const verified = await verifyCanonicalRelease({ api: process.env.CRM_RELATIONS_VERIFY_API, commit: process.env.CRM_RELATIONS_VERIFY_COMMIT, token: process.env.CRM_RELATIONS_VERIFY_TOKEN });
  const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } }, log: [] });
  try {
    const actor = await db.user.findFirst({ where: { id: verified.userId, tenantId: verified.tenantId, status: 'ACTIVE' }, select: { id: true } });
    if (!actor) fail('VERIFIED_API_DATABASE_MISMATCH');
    console.log(JSON.stringify({ commit: verified.commit, capability: verified.capability, authenticatedReads: true }));
    if (process.argv[2] === '--retire') {
      await db.$executeRawUnsafe(`COMMENT ON TABLE "MailboxThreadAssociation" IS 'canonical-crm-relations-api-verified-v1'`);
      try { migrate(retirement); }
      finally { await db.$executeRawUnsafe('COMMENT ON TABLE "MailboxThreadAssociation" IS NULL'); }
    }
  } finally { await db.$disconnect(); }
}
module.exports = { verifyCanonicalRelease };
if (require.main === module) main().catch(error => { console.error('[canonical-rollout]', error.code || error.name); process.exitCode = 1; });
