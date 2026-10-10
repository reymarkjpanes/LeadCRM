// Only this authenticated release gate enables the destructive Lead migration.
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { deploymentPlan, migrate } = require('./deploy-crm-imports.cjs');
const retirement = '20261112000000_retire_lead_nonform_columns';
const fail = code => { throw Object.assign(new Error(code), { code }); };
async function verifyLeadRelease({ api, commit, token }, request = fetch) {
  if (!api || !/^[a-f0-9]{40}$/.test(commit || '') || !token) fail('LEAD_RELEASE_CONFIGURATION_REQUIRED');
  const url = new URL(api);
  if (url.protocol !== 'https:' || url.username || url.password) fail('HTTPS_API_REQUIRED');
  const get = async path => {
    const response = await request(api.replace(/\/$/, '') + path, { headers: { Authorization: `Bearer ${token}`, Cookie: `leadcrm_token=${token}`, 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) fail('LEAD_API_CHECK_FAILED');
    return response.json();
  };
  const health = await get('/health');
  if (health.commit !== commit || !health.capabilities?.includes('lead-form-contract-v1')) fail('LEAD_RELEASE_NOT_SERVING');
  const me = await get('/auth/me'), user = me.data?.user ?? me.data;
  if (!user?.id || !user?.tenantId || user.role !== 'Client Admin') fail('LEAD_ADMIN_VERIFICATION_REQUIRED');
  const list = await get('/crm/leads?page=1&limit=2');
  if (!Array.isArray(list.data)) fail('LEAD_LIST_CONTRACT_INVALID');
  const check = lead => {
    if (['description', 'website', 'productInterestOther', 'creationKey', 'productsNormalized'].some(key => Object.hasOwn(lead, key)) || !Array.isArray(lead.productInterestIds)) fail('LEAD_PUBLIC_CONTRACT_INVALID');
  };
  for (const lead of list.data) { check(lead); check((await get(`/crm/leads/${encodeURIComponent(lead.id)}`)).data); }
  return { commit, userId: user.id, tenantId: user.tenantId, capability: 'lead-form-contract-v1', recordsChecked: list.data.length };
}
async function main() {
  if (!['--verify', '--retire'].includes(process.argv[2])) fail('INVALID_MODE');
  const verified = await verifyLeadRelease({ api: process.env.CRM_LEADS_VERIFY_API, commit: process.env.CRM_LEADS_VERIFY_COMMIT, token: process.env.CRM_LEADS_VERIFY_TOKEN });
  const db = new PrismaClient({ log: [], datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
  try {
    if (!await db.user.findFirst({ where: { id: verified.userId, tenantId: verified.tenantId, status: 'ACTIVE', role: 'Client Admin' }, select: { id: true } })) fail('VERIFIED_API_DATABASE_MISMATCH');
    const records = await db.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"');
    const plan = deploymentPlan(records, readdirSync(resolve(__dirname, '../prisma/migrations')));
    if (!records.some(row => row.migration_name === '20261110000000_preserve_retired_lead_fields' && row.finished_at && !row.rolled_back_at)) fail('LEAD_PRESERVATION_MIGRATION_REQUIRED');
    console.log(JSON.stringify({ commit: verified.commit, capability: verified.capability, recordsChecked: verified.recordsChecked, authenticatedReads: true }));
    if (process.argv[2] === '--retire') {
      await db.$executeRawUnsafe(`COMMENT ON TABLE "Lead" IS 'lead-form-contract-api-verified-v1'`);
      try { migrate(retirement, plan.exclude.filter(name => name !== retirement)); }
      finally { await db.$executeRawUnsafe('COMMENT ON TABLE "Lead" IS NULL'); }
    }
  } finally { await db.$disconnect(); }
}
module.exports = { verifyLeadRelease };
if (require.main === module) main().catch(error => { console.error('[lead-field-rollout]', error.code || error.name); process.exitCode = 1; });
