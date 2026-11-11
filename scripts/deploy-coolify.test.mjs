import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coordinateRelease, trustedCandidate, configuration, productionIO, http, verifyWebhookIngress } from './deploy-coolify.mjs';

const commit = 'a'.repeat(40), old = 'b'.repeat(40);
const config = { repository: 'reymarkjpanes/LeadCRM', backend: 'backend000', frontend: 'frontend00', database: 'database00', backup: 'backup0000', backupTimeout: 30000 };
const event = () => ({ repository: { id: 1, full_name: config.repository }, workflow_run: { id: 123, name: 'CI — Local acceptance and container compatibility', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', head_sha: commit, head_repository: { id: 1, full_name: config.repository }, pull_requests: [] } });
function fixture(options = {}) {
  let time = Date.parse('2026-10-13T00:00:00Z');
  const calls = [], pins = {}, histories = { backend000: [{ status: 'finished', commit: old, deployment_uuid: 'oldbackend' }], frontend00: [{ status: 'finished', commit: old, deployment_uuid: 'oldfrontend' }] };
  const serving = { backend: old, frontend: old };
  const role = app => app === config.backend ? 'backend' : 'frontend';
  const io = {
    now: () => time, sleep: async duration => { time += duration; },
    ci: async () => event().workflow_run, latest: async () => options.latest || commit,
    application: async app => ({ uuid: app, build_pack: 'nixpacks', git_repository: config.repository, git_branch: 'main', settings: { is_auto_deploy_enabled: false }, git_commit_sha: pins[app] }),
    pin: async (app, value) => { calls.push(['pin', app, value]); pins[app] = value; },
    deployments: async app => histories[app],
    deploy: async app => {
      calls.push(['deploy', app]);
      assert.equal(pins[config.backend], commit); assert.equal(pins[config.frontend], commit);
      if (app === config.frontend) assert.equal(serving.backend, commit);
      const deployment = { status: 'queued', commit, deployment_uuid: `${role(app)}deploy`, pull_request_id: 0 };
      histories[app].unshift(deployment);
      if (options.timeout) throw Object.assign(Error('unconfirmed'), { code: 'HTTP_REQUEST_UNCONFIRMED' });
      return { deployments: [{ resource_uuid: app, deployment_uuid: deployment.deployment_uuid }] };
    },
    deployment: async id => {
      const app = id.startsWith('backend') ? config.backend : config.frontend;
      const item = histories[app].find(row => row.deployment_uuid === id);
      item.status = options.fail === role(app) ? 'failed' : 'finished';
      if (item.status === 'finished') serving[role(app)] = commit;
      return item;
    },
    migrationsChanged: async () => Boolean(options.migration),
    backups: async () => calls.some(call => call[0] === 'backup') ? [{ uuid: 'newbackup0', created_at: new Date(time).toISOString(), status: options.backupFails ? 'failed' : 'success' }] : [],
    backupNow: async () => { calls.push(['backup']); },
    health: async kind => ({ status: 'ok', commit: options.mismatch === kind ? old : serving[kind], env: 'production' }),
    login: async () => { calls.push(['login']); return true; },
    proxy: async () => ({ status: 'ok', commit: options.proxyMismatch ? old : commit, env: 'production' }),
    webhookIngress: async () => { calls.push(['webhook-ingress']); return { brevo: 401, textbee: 401 }; },
  };
  return { io, calls, pins, histories, serving };
}
async function rejected(f, code, input = event()) {
  const report = {};
  await assert.rejects(coordinateRelease(config, input, f.io, report), error => error.code === code);
  assert.equal(report.status, 'failed'); assert.equal(report.reason, code);
  return report;
}

test('only successful trusted push main CI can release; fork, PR, failed and spoofed events cannot mutate', async () => {
  for (const change of [
    run => { run.event = 'pull_request'; }, run => { run.head_branch = 'feature'; }, run => { run.conclusion = 'failure'; },
    run => { run.head_repository.id = 2; }, run => { run.head_repository.full_name = 'fork/LeadCRM'; },
    run => { run.head_sha = 'main'; }, run => { run.path = '.github/workflows/other.yml'; },
  ]) {
    const input = event(); change(input.workflow_run); assert.equal(trustedCandidate(input, config.repository), false);
    const f = fixture(); await rejected(f, 'UNTRUSTED_CI_EVENT', input); assert.deepEqual(f.calls, []);
  }
});
test('a trusted main push may reference an associated PR without becoming a PR event', () => {
  const input = event(); input.workflow_run.pull_requests = [{ number: 117 }];
  assert.equal(trustedCandidate(input, config.repository), true);
});
test('CI is rechecked server-side before any release mutation', async () => {
  const f = fixture(); f.io.ci = async () => ({ ...event().workflow_run, conclusion: 'failure' });
  await rejected(f, 'CI_RUN_NOT_VERIFIED'); assert.deepEqual(f.calls, []);
});
test('superseded commits skip without pinning, backups or webhook calls', async () => {
  const f = fixture({ latest: old }); const result = await coordinateRelease(config, event(), f.io);
  assert.equal(result.status, 'skipped'); assert.deepEqual(f.calls, []);
});
test('both applications are pinned and backend health passes before frontend dispatch', async () => {
  const f = fixture(); const result = await coordinateRelease(config, event(), f.io);
  assert.equal(result.status, 'success');
  assert.deepEqual(f.calls.map(call => call.slice(0, 2)), [['pin', config.backend], ['pin', config.frontend], ['deploy', config.backend], ['webhook-ingress'], ['deploy', config.frontend], ['login']]);
  assert.equal(result.backend.commit, commit); assert.equal(result.frontend.commit, commit);
});

test('broken webhook ingress blocks frontend dispatch and reports an actionable failure', async () => {
  const f = fixture();
  f.io.webhookIngress = async () => { throw Object.assign(Error(), { code: 'BREVO_WEBHOOK_INGRESS_HTTP_400_EXPECTED_401' }); };
  const report = await rejected(f, 'BREVO_WEBHOOK_INGRESS_HTTP_400_EXPECTED_401');
  assert.equal(report.phase, 'webhook-ingress');
  assert.equal(f.calls.some(call => call[0] === 'deploy' && call[1] === config.frontend), false);
});

test('public ingress probes are bounded, unsigned, nonredirecting and require 401 for both providers', async () => {
  const saved = globalThis.fetch, requests = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response('Unauthorized', { status: 401 });
    };
    assert.deepEqual(await verifyWebhookIngress('https://api.example'), { brevo: 401, textbee: 401 });
    assert.deepEqual(requests.map(r => r.url), ['https://api.example/api/v1/webhooks/brevo', 'https://api.example/api/v1/webhooks/textbee']);
    for (const { options } of requests) {
      assert.equal(options.method, 'POST'); assert.equal(options.body, '{}');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    }
    for (const provider of ['brevo', 'textbee']) for (const status of [200, 400, 429, 503]) {
      globalThis.fetch = async url => new Response('private details', { status: url.endsWith(provider) ? status : 401 });
      await assert.rejects(verifyWebhookIngress('https://api.example'), error => error.code === `${provider.toUpperCase()}_WEBHOOK_INGRESS_HTTP_${status}_EXPECTED_401`);
    }
    globalThis.fetch = async () => { throw Error('private transport details'); };
    await assert.rejects(verifyWebhookIngress('https://api.example'), error => error.code === 'BREVO_WEBHOOK_INGRESS_UNAVAILABLE');
  } finally { globalThis.fetch = saved; }
});
test('the manual release command checks direct ingress and cannot pass the reproduced proxy failure', () => {
  const script = fileURLToPath(new URL('./verify-deployment.cjs', import.meta.url));
  for (const status of [401, 400]) {
    const result = spawnSync(process.execPath, ['-e', `
      process.argv = ['node', ${JSON.stringify(script)}, 'https://site.example', '${commit}', 'https://api.example'];
      globalThis.fetch = async url => String(url).endsWith('/health')
        ? Response.json({ status: 'ok', commit: '${commit}' })
        : new Response('private response body', { status: String(url).includes('/webhooks/') ? ${status} : 401 });
      require(${JSON.stringify(script)});
    `], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(result.status, status === 401 ? 0 : 1, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /private response body/);
    if (status === 400) assert.match(result.stderr, /BREVO_WEBHOOK_INGRESS_HTTP_400_EXPECTED_401/);
    else assert.match(result.stdout, /separately verify authenticated provider callbacks/);
  }
});

test('migration releases require a fresh successful existing-schedule backup before pinning', async () => {
  const f = fixture({ migration: true }); const result = await coordinateRelease(config, event(), f.io);
  assert.equal(result.backup, 'newbackup0'); assert.equal(f.calls[0][0], 'backup');
});
test('old successful backups cannot satisfy the fresh backup gate', async () => {
  const f = fixture({ migration: true }); f.io.backups = async () => [{ uuid: 'oldbackup0', created_at: '2026-10-12T00:00:00Z', status: 'success' }];
  await rejected(f, 'BACKUP_TIMEOUT'); assert.deepEqual(f.calls, [['backup']]);
});
test('failed backup prevents application deployment', async () => {
  const f = fixture({ migration: true, backupFails: true }); await rejected(f, 'BACKUP_FAILED');
  assert.deepEqual(f.calls, [['backup']]);
});
test('ambiguous backup request reconciles a fresh result without retriggering', async () => {
  const f = fixture({ migration: true });
  f.io.backupNow = async () => { f.calls.push(['backup']); throw Object.assign(Error(), { code: 'HTTP_REQUEST_UNCONFIRMED' }); };
  assert.equal((await coordinateRelease(config, event(), f.io)).status, 'success');
  assert.equal(f.calls.filter(call => call[0] === 'backup').length, 1);
});
test('backend failure blocks frontend and reports actual serving revisions', async () => {
  const f = fixture({ fail: 'backend' }); const result = await rejected(f, 'BACKEND_DEPLOYMENT_FAILED');
  assert.equal(f.calls.some(call => call[0] === 'deploy' && call[1] === config.frontend), false);
  assert.deepEqual(result.serving, { backend: old, frontend: old });
});
test('frontend failure reports partial release as failed without reverting backend or database', async () => {
  const f = fixture({ fail: 'frontend' }); const result = await rejected(f, 'FRONTEND_DEPLOYMENT_FAILED');
  assert.deepEqual(result.serving, { backend: commit, frontend: old });
  assert.equal(result.phase, 'frontend');
});
test('serving and deployment SHA mismatches cannot pass', async () => {
  for (const kind of ['backend', 'frontend']) {
    const f = fixture({ mismatch: kind }); await rejected(f, `${kind.toUpperCase()}_RELEASE_MISMATCH`);
  }
  const f = fixture(); f.io.deployment = async id => ({ deployment_uuid: id, status: 'finished', commit: old });
  await rejected(f, 'DEPLOYMENT_COMMIT_MISMATCH');
});
test('proxy mismatch or login error cannot report a successful release', async () => {
  await rejected(fixture({ proxyMismatch: true }), 'FRONTEND_PROXY_RELEASE_MISMATCH');
  const f = fixture(); f.io.login = async () => { throw Object.assign(Error(), { code: 'HTTP_503' }); };
  await rejected(f, 'HTTP_503');
});
test('reruns reuse healthy persisted deployments without new webhook calls', async () => {
  const f = fixture(); await coordinateRelease(config, event(), f.io); f.calls.length = 0;
  const result = await coordinateRelease(config, event(), f.io);
  assert.equal(result.backend.reused, true); assert.equal(result.frontend.reused, true);
  assert.equal(f.calls.some(call => call[0] === 'deploy'), false);
});
test('matching queued deployment is reused; a different in-flight release blocks the candidate', async () => {
  const f = fixture(); f.histories[config.backend].unshift({ deployment_uuid: 'backendqueued', commit, status: 'queued' });
  await coordinateRelease(config, event(), f.io);
  assert.equal(f.calls.some(call => call[0] === 'deploy' && call[1] === config.backend), false);
  const other = fixture(); other.histories[config.backend].unshift({ deployment_uuid: 'otherdeploy', commit: old, status: 'in_progress' });
  await rejected(other, 'OTHER_RELEASE_IN_PROGRESS'); assert.deepEqual(other.calls, []);
});
test('webhook timeout reconciles the created deployment without duplicate POSTs', async () => {
  const f = fixture({ timeout: true }); assert.equal((await coordinateRelease(config, event(), f.io)).status, 'success');
  assert.equal(f.calls.filter(call => call[0] === 'deploy').length, 2);
});
test('unconfirmed webhook with no queue record fails without blind retry', async () => {
  const f = fixture(); f.io.deploy = async app => { f.calls.push(['deploy', app]); throw Object.assign(Error(), { code: 'HTTP_REQUEST_UNCONFIRMED' }); };
  await rejected(f, 'DEPLOYMENT_REQUEST_UNCONFIRMED'); assert.equal(f.calls.filter(call => call[0] === 'deploy').length, 1);
});
test('unsaved pin, enabled push deployment and unknown baseline each block dispatch', async () => {
  const pin = fixture(); pin.io.pin = async () => {}; await rejected(pin, 'APPLICATION_PIN_NOT_SAVED');
  const auto = fixture(), original = auto.io.application; auto.io.application = async app => ({ ...await original(app), settings: { is_auto_deploy_enabled: true } });
  await rejected(auto, 'APPLICATION_CONFIGURATION_NOT_READY'); assert.deepEqual(auto.calls, []);
  const baseline = fixture(); baseline.histories[config.backend] = []; await rejected(baseline, 'UNKNOWN_BACKEND_BASELINE');
});
test('candidate superseded during backup stops before pinning', async () => {
  const f = fixture({ migration: true }); let calls = 0; f.io.latest = async () => ++calls === 1 ? commit : old;
  assert.equal((await coordinateRelease(config, event(), f.io)).status, 'skipped'); assert.deepEqual(f.calls, [['backup']]);
});
test('main moving after backend dispatch still finishes the same pinned release pair', async () => {
  const f = fixture(); f.io.latest = async () => f.calls.some(call => call[0] === 'deploy') ? old : commit;
  assert.equal((await coordinateRelease(config, event(), f.io)).status, 'success');
});
test('runtime IO refuses database deploy targets and restricts credentials to their endpoints', async () => {
  const saved = globalThis.fetch, requests = [];
  const runtime = { ...config, coolify: 'https://coolify.example', configToken: 'configuration-private', deployToken: 'deploy-private' };
  try {
    globalThis.fetch = async (url, options) => { requests.push({ url, options }); return Response.json({ deployments: [] }); };
    const io = productionIO(runtime);
    assert.throws(() => io.deploy(config.database), /APPLICATION_NOT_ALLOWED/);
    assert.throws(() => io.pin(config.database, commit), /APPLICATION_NOT_ALLOWED/);
    await io.pin(config.backend, commit); await io.deploy(config.backend); await io.backupNow();
    assert.deepEqual(requests.map(item => JSON.parse(item.options.body)), [{ git_commit_sha: commit }, { uuid: config.backend, force: false }, { backup_now: true }]);
    assert.deepEqual(requests.map(item => item.options.headers.Authorization), ['Bearer configuration-private', 'Bearer deploy-private', 'Bearer configuration-private']);
    assert.ok(requests.every(item => !/configuration-private|deploy-private/.test(item.url) && item.options.redirect === 'error'));
  } finally { globalThis.fetch = saved; }
});
test('HTTP errors are sanitized and requests are bounded', async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async (_, options) => { assert.ok(options.signal); return new Response('private-token-and-backup-data', { status: 401 }); };
    await assert.rejects(http('https://coolify.example'), error => error.message === 'HTTP_401');
    globalThis.fetch = async () => { throw Error('sensitive request detail'); };
    await assert.rejects(http('https://coolify.example'), error => error.message === 'HTTP_REQUEST_UNCONFIRMED');
  } finally { globalThis.fetch = saved; }
});
test('environment rejects shared tokens, duplicate database targets and untrusted origins', () => {
  const env = { GITHUB_REPOSITORY: config.repository, COOLIFY_URL: 'https://coolify.example', COOLIFY_BACKEND_UUID: config.backend, COOLIFY_FRONTEND_UUID: config.frontend, COOLIFY_DATABASE_UUID: config.database, COOLIFY_BACKUP_UUID: config.backup, RELEASE_API_URL: 'https://api.example', RELEASE_FRONTEND_URL: 'https://app.example', COOLIFY_CONFIG_TOKEN: 'config-private', COOLIFY_DEPLOY_TOKEN: 'deploy-private', GITHUB_TOKEN: 'github-private' };
  assert.equal(configuration(env).backupTimeout, 3600000);
  assert.throws(() => configuration({ ...env, COOLIFY_DEPLOY_TOKEN: env.COOLIFY_CONFIG_TOKEN }), /SHARED_RELEASE_CREDENTIALS/);
  assert.throws(() => configuration({ ...env, COOLIFY_BACKEND_UUID: config.database }), /INVALID_RELEASE_RESOURCES/);
  for (const url of ['http://coolify.example', 'https://token@coolify.example', 'https://coolify.example/path', 'https://coolify.example?token=private']) assert.throws(() => configuration({ ...env, COOLIFY_URL: url }), /INVALID_RELEASE_ORIGIN/);
});
test('workflow serializes production without cancellation and provides no PR deployment credentials', () => {
  const path = new URL('../.github/workflows/deploy-production.yml', import.meta.url);
  if (!existsSync(path)) {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    assert.doesNotMatch(ci, /COOLIFY_|DATABASE_URL|DIRECT_URL|environment: production|deploy-coolify\.mjs|pull_request_target:/);
    return; // Manual deployment mode has no Actions release workflow or credentials.
  }
  const workflow = readFileSync(path, 'utf8');
  assert.match(workflow, /workflow_run:/); assert.doesNotMatch(workflow, /pull_request_target:|workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: false/); assert.match(workflow, /environment: production/);
  assert.match(workflow, /event == 'push'/); assert.match(workflow, /head_repository\.id == github\.repository_id/);
  assert.doesNotMatch(workflow, /DATABASE_URL|DIRECT_URL|root:|read:sensitive/);
  for (const match of workflow.matchAll(/uses: ([^\s#]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
});
