// Production release coordinator. No database credentials, SQL or resource
// lifecycle endpoints are accepted here. Coolify retains its source builds.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-z0-9-]{8,80}$/.test(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const active = row => ['queued', 'in_progress'].includes(row.status);
export function trustedCandidate(event, repository) {
  const run = event.workflow_run;
  return event.repository?.full_name === repository && run?.head_repository?.full_name === repository
    && run.head_repository.id === event.repository.id && run.event === 'push' && run.head_branch === 'main'
    && run.conclusion === 'success' && run.path === '.github/workflows/ci.yml'
    && run.name === 'CI — Local acceptance and container compatibility' && sha(run.head_sha)
    && Number.isSafeInteger(run.id);
}

export function configuration(env) {
  const origin = value => {
    let url; try { url = new URL(value); } catch { fail('INVALID_RELEASE_ORIGIN'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('INVALID_RELEASE_ORIGIN');
    return url.origin;
  };
  const config = {
    repository: env.GITHUB_REPOSITORY,
    coolify: origin(env.COOLIFY_URL), backend: env.COOLIFY_BACKEND_UUID, frontend: env.COOLIFY_FRONTEND_UUID,
    database: env.COOLIFY_DATABASE_UUID, backup: env.COOLIFY_BACKUP_UUID,
    api: origin(env.RELEASE_API_URL), site: origin(env.RELEASE_FRONTEND_URL),
    configToken: env.COOLIFY_CONFIG_TOKEN, deployToken: env.COOLIFY_DEPLOY_TOKEN, githubToken: env.GITHUB_TOKEN,
    backupTimeout: Number(env.COOLIFY_BACKUP_TIMEOUT_SECONDS || 3600) * 1000,
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '') || [config.backend, config.frontend, config.database, config.backup].some(value => !uuid(value))
    || new Set([config.backend, config.frontend, config.database]).size !== 3) fail('INVALID_RELEASE_RESOURCES');
  if (![config.configToken, config.deployToken, config.githubToken].every(value => typeof value === 'string' && value.trim())
    || config.configToken === config.deployToken) fail('MISSING_OR_SHARED_RELEASE_CREDENTIALS');
  if (!Number.isInteger(config.backupTimeout) || config.backupTimeout < 10000 || config.backupTimeout > 3600000) fail('INVALID_BACKUP_TIMEOUT');
  return config;
}

// Never print response bodies: even nonsensitive API errors can echo input.
export async function http(url, { token, method = 'GET', body, json = true } = {}) {
  let response;
  try {
    response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), cache: 'no-store',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { fail('HTTP_REQUEST_UNCONFIRMED'); }
  if (!response.ok) fail(`HTTP_${response.status}`);
  if (!json) { await response.arrayBuffer(); return true; }
  try { return await response.json(); } catch { fail('INVALID_API_RESPONSE'); }
}

// These probes contain no credentials or events. A 401 proves only that public
// HTTPS reaches provider authentication, not that an authenticated event works.
export async function verifyWebhookIngress(api) {
  const statuses = {};
  for (const provider of ['brevo', 'textbee']) {
    let response;
    try {
      response = await fetch(`${api}/api/v1/webhooks/${provider}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      await response.arrayBuffer();
    } catch { fail(`${provider.toUpperCase()}_WEBHOOK_INGRESS_UNAVAILABLE`); }
    if (response.status !== 401) fail(`${provider.toUpperCase()}_WEBHOOK_INGRESS_HTTP_${response.status}_EXPECTED_401`);
    statuses[provider] = response.status;
  }
  return statuses;
}

export function productionIO(config) {
  const request = (path, options = {}) => http(`${config.coolify}/api/v1${path}`, { token: config.configToken, ...options });
  const app = id => { if (![config.backend, config.frontend].includes(id)) fail('APPLICATION_NOT_ALLOWED'); return id; };
  return {
    now: Date.now, sleep: delay,
    latest: async () => (await http(`https://api.github.com/repos/${config.repository}/git/ref/heads/main`, { token: config.githubToken })).object?.sha,
    ci: id => http(`https://api.github.com/repos/${config.repository}/actions/runs/${id}`, { token: config.githubToken }),
    application: id => request(`/applications/${app(id)}`),
    pin: (id, commit) => { if (!sha(commit)) fail('INVALID_COMMIT'); return request(`/applications/${app(id)}`, { method: 'PATCH', body: { git_commit_sha: commit } }); },
    deployments: async id => {
      const result = await request(`/deployments/applications/${app(id)}?take=100`);
      if (!Array.isArray(result.deployments)) fail('INVALID_DEPLOYMENT_HISTORY');
      return result.deployments.filter(row => Number(row.pull_request_id ?? 0) === 0);
    },
    deployment: id => { if (!uuid(id)) fail('INVALID_DEPLOYMENT_UUID'); return request(`/deployments/${id}`); },
    deploy: id => http(`${config.coolify}/api/v1/deploy`, { token: config.deployToken, method: 'POST', body: { uuid: app(id), force: false } }),
    backups: async () => {
      const result = await request(`/databases/${config.database}/backups/${config.backup}/executions`);
      if (!Array.isArray(result.executions)) fail('INVALID_BACKUP_HISTORY');
      return result.executions;
    },
    backupNow: () => request(`/databases/${config.database}/backups/${config.backup}`, { method: 'PATCH', body: { backup_now: true } }),
    migrationsChanged: (before, after) => {
      if (!sha(before) || !sha(after)) fail('UNKNOWN_BACKEND_BASELINE');
      // Full checkout is required. No shell interpolation or credentials.
      try { return Boolean(execFileSync('git', ['diff', '--name-only', before, after, '--', 'backend/prisma/migrations'], { encoding: 'utf8' }).trim()); }
      catch { fail('BACKEND_BASELINE_NOT_IN_CHECKOUT'); }
    },
    health: role => http(role === 'backend' ? `${config.api}/api/v1/health` : `${config.site}/api/release`),
    login: () => http(`${config.site}/login`, { json: false }),
    proxy: () => http(`${config.site}/api/proxy/health`),
    webhookIngress: () => verifyWebhookIngress(config.api),
  };
}

async function poll(io, timeout, attempt, code) {
  const deadline = io.now() + timeout;
  do {
    const result = await attempt();
    if (result) return result;
    if (io.now() >= deadline) break;
    await io.sleep(Math.min(10000, deadline - io.now()));
  } while (io.now() <= deadline);
  fail(code);
}

async function releaseHealth(io, role, commit) {
  return poll(io, 120000, async () => {
    try { const result = await io.health(role); return result.status === 'ok' && result.commit === commit && result.env === 'production' ? result : null; }
    catch { return null; }
  }, `${role.toUpperCase()}_RELEASE_MISMATCH`);
}

async function freshBackup(io, config) {
  const before = new Set((await io.backups()).map(row => row.uuid));
  const started = io.now();
  // A timed-out request may already have dispatched the backup. Reconcile its
  // new execution; never repeat the mutation on an ambiguous response.
  try { await io.backupNow(); } catch (error) { if (error.code !== 'HTTP_REQUEST_UNCONFIRMED') throw error; }
  const result = await poll(io, config.backupTimeout, async () => {
    const fresh = (await io.backups()).filter(row => !before.has(row.uuid) && Date.parse(row.created_at) >= started - 1000);
    if (fresh.some(row => row.status === 'failed')) fail('BACKUP_FAILED');
    return fresh.find(row => row.status === 'success') ?? null;
  }, 'BACKUP_TIMEOUT');
  if (!uuid(result.uuid)) fail('INVALID_BACKUP_UUID');
  return result.uuid;
}

async function deployApplication(io, role, app, commit, report) {
  let history = await io.deployments(app);
  const matching = history.find(row => active(row) && row.commit === commit);
  if (history.some(row => active(row) && row.commit !== commit)) fail('OTHER_RELEASE_IN_PROGRESS');
  const success = history.find(row => row.status === 'finished' && row.commit === commit);
  if (!matching && success) {
    try {
      const health = await io.health(role);
      if (health.status === 'ok' && health.commit === commit && health.env === 'production') {
        report[role] = { deployment: success.deployment_uuid, commit, reused: true }; return;
      }
    } catch { /* A failed health check requires a fresh application deployment. */ }
  }
  let deployment = matching?.deployment_uuid;
  if (!deployment) {
    const previous = new Set(history.map(row => row.deployment_uuid));
    try {
      const result = await io.deploy(app);
      deployment = result.deployments?.find(row => row.resource_uuid === app)?.deployment_uuid;
      if (!uuid(deployment)) fail('DEPLOYMENT_NOT_ACCEPTED');
    } catch (error) {
      if (error.code !== 'HTTP_REQUEST_UNCONFIRMED') throw error;
      // Do not POST again. A delayed queue insert must be found by UUID and SHA.
      deployment = await poll(io, 120000, async () => {
        history = await io.deployments(app);
        const candidates = history.filter(row => !previous.has(row.deployment_uuid) && row.commit === commit);
        if (candidates.length > 1) fail('AMBIGUOUS_DEPLOYMENT');
        return candidates[0]?.deployment_uuid;
      }, 'DEPLOYMENT_REQUEST_UNCONFIRMED');
    }
  }
  if (!uuid(deployment)) fail('INVALID_DEPLOYMENT_UUID');
  report[role] = { deployment, commit, reused: Boolean(matching) };
  await poll(io, 20 * 60 * 1000, async () => {
    const result = await io.deployment(deployment);
    if (result.deployment_uuid !== deployment || Number(result.pull_request_id ?? 0) !== 0) fail('DEPLOYMENT_IDENTITY_MISMATCH');
    // Queued builds can lack a resolved commit until checkout completes.
    if (result.commit && result.commit !== commit) fail('DEPLOYMENT_COMMIT_MISMATCH');
    if (['failed', 'cancelled', 'cancelled-by-user'].includes(result.status)) fail(`${role.toUpperCase()}_DEPLOYMENT_FAILED`);
    if (result.status === 'finished') { if (result.commit !== commit) fail('DEPLOYMENT_COMMIT_MISMATCH'); return true; }
    if (!active(result)) fail('UNKNOWN_DEPLOYMENT_STATUS');
    return null;
  }, `${role.toUpperCase()}_DEPLOYMENT_TIMEOUT`);
  await releaseHealth(io, role, commit);
}

export async function coordinateRelease(config, event, io, report = {}) {
  Object.assign(report, { status: 'running', phase: 'trust', candidate: event.workflow_run?.head_sha });
  try {
    if (!trustedCandidate(event, config.repository)) fail('UNTRUSTED_CI_EVENT');
    const commit = event.workflow_run.head_sha;
    const run = await io.ci(event.workflow_run.id);
    if (!trustedCandidate({ repository: event.repository, workflow_run: run }, config.repository) || run.head_sha !== commit || run.status !== 'completed') fail('CI_RUN_NOT_VERIFIED');
    report.phase = 'latest-main';
    if (await io.latest() !== commit) return Object.assign(report, { status: 'skipped', reason: 'SUPERSEDED_BY_NEWER_MAIN' });
    report.phase = 'configuration';
    for (const app of [config.backend, config.frontend]) {
      const result = await io.application(app);
      if (result.uuid !== app || result.build_pack !== 'nixpacks' || result.git_branch !== 'main'
        || !['reymarkjpanes/LeadCRM', 'https://github.com/reymarkjpanes/LeadCRM', 'https://github.com/reymarkjpanes/LeadCRM.git'].includes(result.git_repository)
        || result.settings?.is_auto_deploy_enabled !== false) fail('APPLICATION_CONFIGURATION_NOT_READY');
      if ((await io.deployments(app)).some(row => active(row) && row.commit !== commit)) fail('OTHER_RELEASE_IN_PROGRESS');
    }
    report.phase = 'backup';
    const history = await io.deployments(config.backend);
    const baseline = history.find(row => row.status === 'finished' && sha(row.commit));
    if (!baseline) fail('UNKNOWN_BACKEND_BASELINE');
    report.previousBackend = baseline.commit;
    if (await io.migrationsChanged(baseline.commit, commit)) report.backup = await freshBackup(io, config);
    if (await io.latest() !== commit) return Object.assign(report, { status: 'skipped', reason: 'SUPERSEDED_BY_NEWER_MAIN' });
    report.phase = 'pin';
    for (const app of [config.backend, config.frontend]) {
      await io.pin(app, commit);
      if ((await io.application(app)).git_commit_sha !== commit) fail('APPLICATION_PIN_NOT_SAVED');
    }
    if (await io.latest() !== commit) return Object.assign(report, { status: 'skipped', reason: 'SUPERSEDED_BY_NEWER_MAIN' });
    // Once backend dispatch begins, finish this pinned pair even if main moves.
    report.phase = 'backend';
    await deployApplication(io, 'backend', config.backend, commit, report);
    report.phase = 'webhook-ingress';
    report.webhookIngress = await io.webhookIngress();
    report.phase = 'frontend';
    await deployApplication(io, 'frontend', config.frontend, commit, report);
    report.phase = 'public-verification';
    await releaseHealth(io, 'backend', commit); await releaseHealth(io, 'frontend', commit);
    await io.login();
    const proxy = await io.proxy();
    if (proxy.status !== 'ok' || proxy.commit !== commit || proxy.env !== 'production') fail('FRONTEND_PROXY_RELEASE_MISMATCH');
    return Object.assign(report, { status: 'success', phase: 'complete' });
  } catch (error) {
    report.status = 'failed'; report.reason = error.code || 'RELEASE_COORDINATION_FAILED';
    report.serving = {};
    for (const role of ['backend', 'frontend']) {
      try { const result = await io.health(role); report.serving[role] = sha(result.commit) ? result.commit : 'unknown'; }
      catch { report.serving[role] = 'unavailable'; }
    }
    throw Object.assign(new Error(report.reason), { code: report.reason });
  }
}

async function main() {
  const report = {};
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (!trustedCandidate(event, process.env.GITHUB_REPOSITORY)) fail('UNTRUSTED_CI_EVENT');
    const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (checkedOut !== event.workflow_run.head_sha) fail('CHECKOUT_COMMIT_MISMATCH');
    const config = configuration(process.env);
    await coordinateRelease(config, event, productionIO(config), report);
  } catch (error) {
    report.status = 'failed'; report.reason ||= error.code || 'RELEASE_CONFIGURATION_FAILED';
    process.exitCode = 1;
  } finally {
    writeFileSync('coolify-release.json', JSON.stringify(report, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Coolify release\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
    console.log(JSON.stringify(report));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
