// Real-browser acceptance fixture. Uses an in-memory database and the local production build.
// Stop by creating data/outputs/product-normalization-tests/stop-preview.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayCrmMigrations } from './replay-crm-migrations.mjs';
const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'data/outputs/product-normalization-tests');
mkdirSync(output, { recursive: true });
const stopFile = resolve(output, 'stop-preview');
if (existsSync(stopFile)) unlinkSync(stopFile);
const db = await PGlite.create();
await replayCrmMigrations(db);
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0 });
await socket.start();
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/leadcrm_product_preview?connection_limit=1&statement_cache_size=0`,
  JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex') });
process.env.DIRECT_URL = process.env.DATABASE_URL;
const require = createRequire(import.meta.url);
const Module = require('node:module'), originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  return request === '@leadcrm/shared' ? resolve(root, 'backend/dist/shared/src/index.js') : originalResolve.call(this, request, parent, isMain, options);
};
const prisma = require('../dist/backend/src/config/database.config.js').default;
const app = require('../dist/backend/src/app.js').default;
const { hashSync } = require('bcryptjs');
const tenant = await prisma.tenant.create({ data: { name: 'Product Acceptance', slug: randomUUID(), onboardingStep: 3, onboardingCompletedAt: new Date() } });
await prisma.user.create({ data: { tenantId: tenant.id, firstName: 'Product', lastName: 'Tester', email: 'product-preview@camxian.com',
  passwordHash: hashSync('ProductPreview1!', 8), role: 'Client Admin', status: 'ACTIVE', mustChangePassword: false } });
await prisma.productInterest.create({ data: { tenantId: tenant.id, name: 'CCTV Surveillance System', dealValue: 0 } });
const api = app.listen(0, '127.0.0.1');
await new Promise(done => api.once('listening', done));
const frontend = spawn(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'start', '-p', '3014', '-H', '127.0.0.1'], {
  cwd: resolve(root, 'frontend'), windowsHide: true, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', API_URL: `http://127.0.0.1:${api.address().port}/api/v1` },
});
console.log('Isolated Product browser fixture: http://127.0.0.1:3014; product-preview@camxian.com / ProductPreview1!');
let stopped = false;
async function stop() {
  if (stopped) return; stopped = true;
  clearInterval(timer);
  const prices = await prisma.productInterest.findMany({ where: { tenantId: tenant.id }, select: { name: true, dealValue: true } });
  writeFileSync(resolve(output, 'browser-result.json'), JSON.stringify(prices, null, 2));
  frontend.kill(); api.closeAllConnections(); await new Promise(done => api.close(done));
  await prisma.$disconnect(); await socket.stop(); await db.close();
}
const timer = setInterval(() => { if (existsSync(stopFile)) void stop(); }, 500);
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
frontend.on('exit', () => void stop());
