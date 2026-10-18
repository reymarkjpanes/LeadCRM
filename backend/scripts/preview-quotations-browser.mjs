// Rendered UI preview with isolated API fixtures. Database/API acceptance is
// independently exercised by test-quotations-disposable.mjs; no live email sends.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { acceptancePort } from './verify-browser-matrix.mjs';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const root = resolve(import.meta.dirname, '../..'), output = resolve(root, 'data/outputs/quotations/browser');
const shared = require(resolve(root, 'shared/src/index.js'));
mkdirSync(output, { recursive: true });
const port = await acceptancePort(), base = `http://127.0.0.1:${port}`, log = createWriteStream(resolve(output, 'frontend.log'));
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
  cwd: resolve(root, 'frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', API_URL: 'https://leadcrm-quotation-fixture.example/api/v1', NEXT_TELEMETRY_DISABLED: '1' },
});
child.stdout.pipe(log); child.stderr.pipe(log);
let browser;
const assertions = [], now = new Date().toISOString();
const user = { id: randomUUID(), tenantId: randomUUID(), email: 'preview@camxian.com', role: 'Client Admin', firstName: 'Preview', lastName: 'Sender', status: 'ACTIVE', tenantName: 'Quotation Preview', tenantStatus: 'SANDBOX', onboardingStep: 3, onboardingCompletedAt: now, mustChangePassword: false, hasPassword: true, passwordChangedAt: now, currency: 'PHP', groups: [] };
const lead = { id: randomUUID(), firstName: 'Juan', lastName: 'Customer', email: 'juan@example.test', companyName: 'Customer Company', assignedUserId: user.id };
const product = { id: randomUUID(), name: 'Technical Service', category: 'Services', description: 'Setup and support', dealValue: 1234.56, active: true, createdAt: now, updatedAt: now };
const permissions = Object.fromEntries(['campaigns','leads','contacts','accounts','deals','products','settings','users','groups','roles','custom_fields','archived_data','tasks','forms','notifications','dashboard','reporting'].map(module => [module, Object.fromEntries(['canView','canCreate','canEdit','canArchive','canSend','canViewReports'].map(flag => [flag, true]))]));
const names = ['Standard Sales Quotation','Service Quotation','Software Implementation','Annual Maintenance','Product Quotation','Custom Quotation'];
const pdf = readFileSync(resolve(root, 'data/outputs/quotations/lead.pdf'));
async function fits(page, label, width) {
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].every(element => { const box = element.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1; }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${label}: page overflow at ${width}`);
  assertions.push(`${width}: ${label}`);
}
try {
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(done => setTimeout(done, 500)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [320,375,390,430,768,1024,1440]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let templates = names.map((name, index) => ({ id: randomUUID(), tenantId: user.tenantId, name, category: shared.QUOTATION_CATEGORIES[index], type: 'Quotation', content: JSON.stringify(shared.defaultQuotationContent()) }));
    let sends = 0;
    await context.route('**/api/proxy/**', async route => {
      const url = new URL(route.request().url()), path = url.pathname.replace('/api/proxy', ''), method = route.request().method();
      const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      const list = data => json({ success: true, data, meta: { total: data.length, page: 1, limit: 10, hasMore: false } });
      if (path === '/auth/me') return json({ success: true, data: { user, session: { lastActiveAt: now, idleExpiresAt: new Date(Date.now()+1800000).toISOString(), expiresAt: new Date(Date.now()+86400000).toISOString(), serverNow: new Date().toISOString() } } });
      if (path.endsWith('/permissions')) return json({ success: true, data: permissions });
      if (path.endsWith('/events') || path.endsWith('record-events')) return route.fulfill({ contentType: 'text/event-stream', body: ': UI preview\n\n' });
      if (path.startsWith('/preferences/table/')) return json({ success: true, data: { pageSize: 25, sort: { field: 'createdAt', direction: 'desc' }, conditions: [] } });
      if (path === '/crm/record-access') return json({ success: true, data: { userId: user.id, tenantId: user.tenantId, clientAdmin: true, assignmentRestricted: false } });
      if (path === '/marketing/campaigns/variable-fields') return json({ success: true, data: shared.CUSTOM_FIELD_MODULES.flatMap(module => shared.getCrmFieldCatalog(module)) });
      if (path === '/administration/product-interests') return json({ success: true, data: [product], meta: { enabled: true, categories: ['Services'] } });
      if (path === '/crm/leads') return list([lead]);
      if (path.endsWith('/relationships')) return json({ success: true, data: { deals: [], hasMoreDeals: false } });
      if (path === `/crm/leads/${lead.id}`) return json({ success: true, data: lead });
      if (path.endsWith('/pdf')) return route.fulfill({ contentType: 'application/pdf', body: pdf });
      if (path === '/marketing/templates' && method === 'POST') { const data = route.request().postDataJSON(); const template = { ...data, id: randomUUID(), tenantId: user.tenantId }; templates.push(template); return json({ success: true, data: template }, 201); }
      if (path.startsWith('/marketing/templates/') && method === 'PUT') { const index = templates.findIndex(template => path.endsWith(template.id)); templates[index] = { ...templates[index], ...route.request().postDataJSON() }; return json({ success: true, data: templates[index] }); }
      if (path === '/marketing/templates') { const search = (url.searchParams.get('search') ?? '').toLowerCase(), category = url.searchParams.get('category'); return list(templates.filter(template => (!category || template.category === category) && `${template.name} ${template.category}`.toLowerCase().includes(search))); }
      if (path === '/marketing/campaigns/quotations/preview') return json({ success: true, data: { pdfBase64: pdf.toString('base64'), filename: 'quotation.pdf', fingerprint: 'a'.repeat(64), document: { total: '3703.68' } } });
      if (path === '/marketing/campaigns/quotations/send') { sends++; await new Promise(done => setTimeout(done, 250)); return json({ success: true, data: { messageId: 'fixture', threadId: 'fixture' } }); }
      return list([]);
    });
    try {
      await page.goto(base + '/marketing/campaigns');
      for (const type of ['Email', 'SMS']) {
        await page.getByRole('button', { name: `${type} Templates`, exact: true }).click();
        await page.getByRole('button', { name: `New ${type} Template`, exact: true }).waitFor({ state: 'visible' });
      }
      await page.getByRole('button', { name: 'Quotation Templates', exact: true }).click();
      await page.getByRole('heading', { name: 'Standard Sales Quotation', level: 3 }).waitFor();
      assert.equal(await page.locator('article').count(), 6);
      for (const card of await page.locator('article').all()) {
        const badge = await card.locator('.inline-flex').first().boundingBox(), icon = await card.getByRole('button', { name: 'Download PDF', exact: true }).boundingBox();
        assert.ok(badge && icon && icon.x > badge.x && Math.abs((badge.y + badge.height/2) - (icon.y + icon.height/2)) < 2);
      }
      await fits(page, 'six cards and tabs', width); await page.screenshot({ path: resolve(output, `cards-${width}.png`), fullPage: true });
      const standardCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Standard Sales Quotation', level: 3 }) });
      const [blankDownload] = await Promise.all([page.waitForEvent('download'), standardCard.getByRole('button', { name: 'Download PDF', exact: true }).click()]); assert.equal(blankDownload.suggestedFilename(), 'Standard Sales Quotation.pdf');
      await standardCard.getByRole('button', { name: 'Preview', exact: true }).click(); await page.getByTitle('Quotation template PDF preview').waitFor(); await fits(page, 'reusable template preview/download', width); await page.getByRole('button', { name: 'Close sheet', exact: true }).click();
      await page.getByLabel('Search templates', { exact: true }).fill('Software'); await page.getByRole('heading', { name: 'Software Implementation' }).waitFor(); await page.waitForFunction(() => document.querySelectorAll('article').length === 1); assert.equal(await page.locator('article').count(), 1);
      await page.getByLabel('Search templates', { exact: true }).fill(''); await page.getByRole('heading', { name: 'Standard Sales Quotation', level: 3 }).waitFor();
      await page.getByLabel('Filter quotation templates', { exact: true }).click(); await page.getByRole('checkbox', { name: 'Filter by Software', exact: true }).check(); await fits(page, 'category filter', width);
      await page.getByRole('button', { name: 'Close filters', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('article').length === 1);
      await page.getByLabel('Filter quotation templates', { exact: true }).click(); await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await page.getByRole('button', { name: 'Close filters', exact: true }).click(); await page.getByRole('heading', { name: 'Standard Sales Quotation', level: 3 }).waitFor();
      await page.getByRole('button', { name: 'New Quotation Template', exact: true }).click();
      await page.getByLabel('Template Name', { exact: false }).fill('Saved Preview Template');
      await page.getByLabel('Insert Variable into Introduction / Message').click(); await page.getByLabel('Search variables').fill('organizationName'); await page.getByRole('button', { name: /Organization Name.*organizationName/ }).click();
      assert.match(await page.getByLabel('Introduction / Message', { exact: true }).inputValue(), /{{organizationName}}/);
      await fits(page, 'editor and variable picker', width); await page.screenshot({ path: resolve(output, `editor-${width}.png`) });
      await page.getByRole('button', { name: 'Save Template', exact: true }).click(); await page.getByRole('heading', { name: 'Saved Preview Template' }).waitFor();
      await page.getByRole('button', { name: 'Actions for Saved Preview Template' }).click(); await page.getByRole('menuitem', { name: 'Edit Template' }).click();
      assert.equal(await page.getByLabel('Template Name', { exact: false }).inputValue(), 'Saved Preview Template');
      await page.getByLabel('Quotation Title', { exact: false }).fill('UPDATED QUOTATION'); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await page.getByRole('button', { name: 'Save Template', exact: true }).click();
      await page.locator('article').filter({ has: page.getByRole('heading', { name: 'Standard Sales Quotation', level: 3 }) }).getByRole('button', { name: 'Use Template' }).click();
      await page.getByRole('combobox', { name: 'Search recipient…', exact: true }).click(); await page.getByRole('combobox', { name: 'Search leads', exact: true }).fill('Juan'); await page.getByRole('option').filter({ hasText: 'Juan Customer' }).click();
      await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByRole('button', { name: 'Add Product', exact: false }).click();
      await page.getByLabel('Product Interest', { exact: true }).click(); await page.getByLabel('Search product interest', { exact: true }).fill('Technical'); await page.getByRole('checkbox', { name: 'Technical Service' }).check(); await page.getByLabel('Product Interest', { exact: true }).click();
      await page.getByLabel('Quantity for Technical Service').fill('3'); await fits(page, 'products and four-step progress', width); await page.screenshot({ path: resolve(output, `products-${width}.png`) });
      await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByLabel('Notes', { exact: true }).fill('Quotation preview notes'); await fits(page, 'quotation details', width);
      await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByTitle('Quotation PDF preview').waitFor(); await fits(page, 'PDF preview actions', width); await page.screenshot({ path: resolve(output, `preview-${width}.png`) });
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Download PDF', exact: true }).click()]); assert.equal(download.suggestedFilename(), 'quotation.pdf');
      await page.getByRole('button', { name: 'Send', exact: true }).click(); await page.getByRole('button', { name: 'Sent', exact: true }).waitFor(); assert.equal(sends, 1);
      assert.deepEqual(errors, []); assertions.push(`${width}: Email/SMS creation access, create/edit/discard guard, cursor picker, recipient, Products, details, preview, download, single send`);
    } finally { await context.close(); }
  }
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ evidence: 'Production frontend with isolated API fixtures; database and Gmail transport checks are separate.', assertions, passed: assertions.length }, null, 2));
  console.log(JSON.stringify({ passed: assertions.length, output }));
} catch (error) { writeFileSync(resolve(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, assertions }, null, 2)); throw error; }
finally { await browser?.close(); child.kill(); log.end(); }
