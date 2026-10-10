const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { deploymentTarget, deploymentPlan, verifyAppliedHistory } = require('./deploy-crm-imports.cjs');
const { verifyCanonicalRelease } = require('./deploy-canonical-relationships.cjs');
const config = { api: 'https://crm.example/api/v1', commit: 'a'.repeat(40), token: 'local-test-token' };
const request = (health, status = 200) => async url => ({ ok: status === 200, json: async () => url.endsWith('/health') ? health : { data: { user: { id: 'u', tenantId: 't', role: 'Client Admin' } } } });
test('normal deployment stops before active compatibility column retirement', () => {
  const rows = [{ migration_name: '20261028000000_retire_legacy_crm_imports', finished_at: new Date() }];
  assert.equal(deploymentTarget(rows, []), '20261101000000_expand_canonical_relationships');
  rows.push({ migration_name: '20261102000000_retire_relationship_compatibility', finished_at: new Date() });
  assert.equal(deploymentTarget(rows, []), '\uffff');
});

test('normal deployment rejects applied SQL drift and unknown applied history', () => {
  const name = '20261109000000_campaign_final_statuses';
  const row = { migration_name: name, finished_at: new Date(), checksum: 'not-the-source-hash' };
  assert.throws(() => verifyAppliedHistory([row], []), /APPLIED_MIGRATION_MISSING/);
  assert.throws(() => verifyAppliedHistory([row], [name]), /APPLIED_MIGRATION_CHECKSUM_MISMATCH/);
});

test('only reviewed independent migrations can run while relationship retirement is deferred', () => {
  const rows = [{ migration_name: '20261028000000_retire_legacy_crm_imports', finished_at: new Date() }];
  const names = ['20261102000000_retire_relationship_compatibility', '20261103000000_reply_engagement_deal_batches', '20261104000000_user_first_login_onboarding', '20261105000000_module_custom_fields', '20261106000000_campaign_sms_snapshots'];
  assert.deepEqual(deploymentPlan(rows, names), { through: names[4], exclude: [names[0]] });
  assert.throws(() => deploymentPlan(rows, [...names, '20261105000000_unreviewed']), /REVIEW_MIGRATIONS/);
  const campaignMigrations = ['20261108000000_campaign_delivered_status', '20261109000000_campaign_final_statuses'];
  assert.deepEqual(deploymentPlan(rows, [...names, ...campaignMigrations]), { through: campaignMigrations[1], exclude: [names[0]] });
  assert.throws(() => deploymentPlan([...rows, { migration_name: names[2] }], names), /FAILED_MIGRATION/);
  rows.push({ migration_name: names[0], finished_at: new Date() });
  assert.deepEqual(deploymentPlan(rows, names), { through: '\uffff', exclude: [] });
});
test('canonical retirement rejects old commits, missing capability and unsuccessful endpoints', async () => {
  const health = { commit: config.commit, capabilities: ['canonical-crm-relations-v1'] };
  await verifyCanonicalRelease(config, request(health));
  for (const changed of [{ ...health, commit: 'b'.repeat(40) }, { ...health, capabilities: [] }]) await assert.rejects(verifyCanonicalRelease(config, request(changed)));
  await assert.rejects(verifyCanonicalRelease(config, request(health, 401)));
  await assert.rejects(verifyCanonicalRelease({ ...config, token: '' }, request(health)));
});

test('the complete release history deploys reviewed transitions while guarded column retirements stay deferred', () => {
  const names = readdirSync(resolve(__dirname, '../prisma/migrations'));
  const rows = [{ migration_name: '20261028000000_retire_legacy_crm_imports', finished_at: new Date() }];
  const relationship = '20261102000000_retire_relationship_compatibility';
  const crm = '20261110000000_retire_unused_crm_columns';
  const lead = '20261112000000_retire_lead_nonform_columns';
  const plan = deploymentPlan(rows, names);
  assert.equal(plan.through, '20261121000000_mailbox_reply_header');
  assert.deepEqual(plan.exclude, [relationship, crm, lead]);
  const selected = names.filter(name => /^\d+_/.test(name) && name <= plan.through && !plan.exclude.includes(name));
  for (const name of ['20261106000000_scoped_mailbox_delivery', '20261110000000_preserve_retired_lead_fields',
    '20261111000000_crm_ownership_safety', '20261113000000_mailbox_message_headers', '20261114000000_mailbox_thread_metadata', '20261114000000_notification_delivery',
    '20261115000000_dashboard_revisions', '20261115000000_workflow_assignment_history',
    '20261116000000_user_groups', '20261117000000_campaign_submission_recovery', '20261118000000_group_revisions',
    '20261119000000_notification_utc_timestamps', '20261120000000_password_recovery_security', '20261121000000_mailbox_reply_header']) {
    assert.ok(selected.includes(name), name);
  }
  assert.throws(() => deploymentPlan(rows, [...names, '20261115000000_unreviewed']), /REVIEW_MIGRATIONS/);
  assert.throws(() => deploymentPlan([...rows, { migration_name: selected.at(-1) }], names), /FAILED_MIGRATION/);
  rows.push({ migration_name: relationship, finished_at: new Date() });
  assert.deepEqual(deploymentPlan(rows, names), { through: '\uffff', exclude: [crm, lead] });
  rows.push({ migration_name: crm, finished_at: new Date() }, { migration_name: lead, finished_at: new Date() });
  assert.deepEqual(deploymentPlan(rows, names), { through: '\uffff', exclude: [] });
});
