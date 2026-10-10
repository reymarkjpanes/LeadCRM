// Run against scripts/test-sales-db.mjs --preview and a frontend using its :4101 API.
// Set PLAYWRIGHT_MODULE to an installed Playwright package when it is not in node_modules.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const output = 'data/outputs/csv-import-qa';
mkdirSync(output, { recursive: true });
const base = process.env.CSV_PREVIEW_URL || 'http://localhost:3100';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Disposable local preview required.');
const runId = Date.now();
const email = `${runId}@example.test`;
const personCsv = `First Name,Last Name,Email,Phone Number,Company Name,Full Address,Product Interest\nCSV,Tester,${email},09123456789,CSV Browser Company,Manila,CCTV Surveillance System; Biometrics\nCSV,Duplicate,${email.toUpperCase()},09123456789,CSV Browser Company,Manila,Biometrics\nCSV,Invalid,invalid,09123456789,CSV Browser Company,Manila,Unknown CCTV Package`;
const widths = [1440, 768, 390, 375, 320];
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(45000);
  const errors = [], report = process.argv.includes('--large-only') ? JSON.parse(readFileSync(output + '/browser-results.json', 'utf8')).report : [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '/login');
    await page.getByLabel('Email address').fill('sales-ui@camxian.com');
    await page.getByLabel('Password', { exact: true }).fill('SalesPreview!2026');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.waitForURL('**/dashboard', { timeout: 90000 });
    async function capture(module, step) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: `${output}/${module}-${step}-${width}.png`, fullPage: true });
        const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert(overflow.scroll <= overflow.width + 1, `${module}/${step} overflows at ${width}: ${overflow.scroll}`);
        report.push(`${module}/${step}: ${width}px, no document overflow`);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    async function upload(module, text, drop = false) {
      if (drop) {
        const transfer = await page.evaluateHandle(({ text, name }) => {
          const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'text/csv' })); return dt;
        }, { text, name: `${module}.csv` });
        await page.getByRole('button', { name: 'Upload CSV file' }).dispatchEvent('drop', { dataTransfer: transfer });
      } else {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Browse files' }).click();
        await (await chooser).setFiles({ name: `${module}.csv`, mimeType: 'text/csv', buffer: Buffer.from(text) });
      }
      await page.getByRole('heading', { name: 'Map your columns' }).waitFor();
    }
    for (const module of (process.argv.includes('--large-only') ? [] : ['leads', 'contacts', 'accounts', 'deals'])) {
      await page.goto(`${base}/crm/${module}/import`);
      await page.getByRole('heading', { name: `Import ${module[0].toUpperCase() + module.slice(1)}`, exact: true }).waitFor();
      await capture(module, 'upload');
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download CSV template' }).click();
      const download = await downloadPromise;
      await download.saveAs(`${output}/${module}-template.csv`);
      const template = readFileSync(`${output}/${module}-template.csv`, 'utf8');
      assert(template.includes('Product Interest'));
      if (module === 'deals') assert(!template.split(',').some(h => /value/i.test(h)));
      const text = module === 'leads' ? personCsv
        : module === 'contacts' ? personCsv.replaceAll(email, 'contact-' + email).replaceAll(email.toUpperCase(), ('contact-' + email).toUpperCase())
        : module === 'accounts' ? `Company Name,Product Interest\nCSV Browser Company ${runId},CCTV Surveillance System; Biometrics\n csv browser company ${runId} ,Biometrics\nUnknown Products,Unknown CCTV Package`
        : `Deal Title,Customer Email,Product Interest,Pipeline,Stage\nCCTV Browser ${runId},contact-${email},CCTV Surveillance System,Sales Pipeline,Lead\nBiometrics Browser ${runId},contact-${email},Biometrics,Sales Pipeline,Lead\nCCTV Browser ${runId},contact-${email},CCTV Surveillance System,Sales Pipeline,Lead`;
      await upload(module, text, module === 'accounts');
      await capture(module, 'mapping');
      if (module === 'leads') {
        const mapping = page.getByRole('combobox', { name: 'Map CSV column for Email', exact: true });
        await mapping.selectOption(''); assert(await page.getByRole('button', { name: 'Continue' }).isDisabled());
        await mapping.selectOption('2'); assert(await page.getByRole('button', { name: 'Continue' }).isEnabled());
      }
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('heading', { name: 'Review & validate', exact: true }).waitFor();
      const reviewTable = page.getByRole('table');
      assert.equal(await reviewTable.locator('thead th').count(), await reviewTable.locator('tbody tr').first().locator('td').count());
      assert((await reviewTable.locator('tbody tr').first().innerText()).includes('CCTV Surveillance System'));
      assert((await page.locator('body').innerText()).includes('Duplicate'));
      if (module === 'deals') assert((await page.locator('body').innerText()).includes('Product value:'));
      await capture(module, 'review');
      const importButton = page.getByRole('button', { name: /^Import \d+ / });
      await importButton.dblclick();
      await page.getByRole('heading', { name: 'Import Complete', exact: true }).waitFor();
      await capture(module, 'result');
      const keyUrl = page.url();
      await page.getByRole('button', { name: 'View Details', exact: true }).click();
      await page.getByRole('heading', { name: 'Import Details', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Import Results', exact: true }).waitFor();
      if (module === 'leads') {
        const failedResults = '**/api/proxy/crm/leads/imports/*/results*';
        await page.route(failedResults, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Results temporarily unavailable' }) }));
        await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
        await page.getByRole('button', { name: 'Retry results', exact: true }).waitFor();
        await page.unroute(failedResults);
        await page.getByRole('button', { name: 'Retry results', exact: true }).click();
        await page.getByText('Duplicate CSV email', { exact: false }).waitFor();
        await page.getByRole('button', { name: 'All', exact: true }).click();
      }
      await capture(module, 'details');
      // Re-open the same request key and re-select the source, simulating refresh recovery.
      await page.goto(keyUrl);
      await page.getByRole('button', { name: 'Browse files' }).waitFor();
      await upload(module, text);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('heading', { name: 'Import Complete', exact: true }).waitFor();
      await page.getByRole('button', { name: 'History', exact: true }).click();
      await page.getByRole('heading', { name: 'Import history', exact: true }).waitFor();
      await capture(module, 'history');
      await page.getByRole('button', { name: 'New import', exact: true }).click();
      await page.getByRole('button', { name: 'Browse files' }).waitFor();
      assert(!page.url().includes('importKey'));
      report.push(`${module}: template, upload, mapping, server review, double click, details, refresh recovery, history, new import passed`);
    }
    // Exercise the actual chunk upload transport and multiple execution batches.
    await page.goto(`${base}/crm/accounts/import`);
    await page.getByRole('button', { name: 'Browse files' }).waitFor();
    const largeCsv = 'Company Name,Unused Notes\n' + Array.from({ length: 40 }, (_, i) => `Large CSV ${runId} ${i},${'x'.repeat(20000)}`).join('\n');
    let chunksSent = 0;
    const countChunks = request => { if (request.url().includes('/accounts/imports/upload')) chunksSent++; };
    page.on('request', countChunks);
    await upload('accounts', largeCsv);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Review & validate', exact: true }).waitFor();
    assert(chunksSent > 1, 'Large CSV must use bounded upload requests.');
    let importRequests = 0;
    const execution = '**/api/proxy/crm/accounts/imports';
    await page.route(execution, route => {
      if (route.request().method() === 'POST' && ++importRequests === 2) return route.abort('failed');
      return route.continue();
    });
    await page.getByRole('button', { name: 'Import 40 accounts', exact: true }).click();
    await page.getByText('Retry to resume the same import safely.', { exact: false }).waitFor();
    await page.unroute(execution);
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await page.getByRole('heading', { name: 'Import history', exact: true }).waitFor();
    await page.getByRole('row').filter({ hasText: 'In Progress' }).first().click();
    await page.getByRole('button', { name: 'Resume import', exact: true }).click();
    await page.getByRole('button', { name: 'Browse files' }).waitFor();
    await upload('accounts', largeCsv);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Resume import', exact: true }).click();
    await page.getByRole('heading', { name: 'Import Complete', exact: true }).waitFor();
    assert((await page.locator('body').innerText()).includes('40 accounts imported successfully.'));
    report.push(`Large CSV: ${Buffer.byteLength(largeCsv)} bytes, ${chunksSent} upload chunks including recovery, 40 records, interrupted batch resumed through History passed`);
    page.off('request', countChunks);
    assert.deepEqual(errors, []);
    writeFileSync(`${output}/browser-results.json`, JSON.stringify({ report, errors }, null, 2));
    console.log(report.join('\n'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
