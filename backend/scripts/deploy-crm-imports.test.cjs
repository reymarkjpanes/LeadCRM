const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pendingMigrations } = require('./deploy-crm-imports.cjs');

test('migration preflight reports only unapplied migrations inside the reviewed plan', () => {
  const records = [{ migration_name: '20260101000000_applied', finished_at: new Date(), rolled_back_at: null }];
  const names = [
    '20260101000000_applied',
    '20260102000000_pending',
    '20260103000000_deferred',
    '20260104000000_after_target',
    'migration_lock.toml',
  ];
  const plan = { through: '20260103000000_deferred', exclude: ['20260103000000_deferred'] };
  assert.deepEqual(pendingMigrations(records, names, plan), ['20260102000000_pending']);
});

test('migration preflight reports no pending work after all planned migrations are finished', () => {
  const records = [{ migration_name: '20260101000000_applied', finished_at: new Date(), rolled_back_at: null }];
  const plan = { through: '20260101000000_applied', exclude: [] };
  assert.deepEqual(pendingMigrations(records, ['20260101000000_applied'], plan), []);
});
