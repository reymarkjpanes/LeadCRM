import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv-parser';
import { validateRow } from './row-validator';
import { accountImportConfig, getImportConfig, IMPORT_CONFIGS } from '../configs';
import { importRequiredFields, importRowSchemas, mapImportCsv, type CrmImportModule } from '@leadcrm/shared';

describe('CSV parsing and active import validation', () => {
  it.each(['leads', 'contacts'] as const)('uses shared person-name rules in %s CSV review', module => {
    const person = { firstName: 'María', lastName: 'O’Connor', email: 'visitor@example.test', phone: '9171234567', companyName: 'Acme@123', address: '123 Main St' };
    const config = getImportConfig(module);
    expect(validateRow(config, person, 2).isValid).toBe(true);
    for (const field of ['firstName', 'lastName']) {
      const row = validateRow(config, { ...person, [field]: 'John@1' }, 3);
      expect(row.isValid).toBe(false);
      expect(row.errors.join()).toContain('must not contain numbers.');
      expect(validateRow(config, { ...person, [field]: 'John@' }, 4).errors.join()).toContain('must not contain special characters.');
    }
  });
  it('preserves quoted commas, escaped quotes, newlines and formula-like plain text', () => {
    expect(parseCsv('Title,Description\r\n"Deal, one","A ""quote"""\r\n=SUM(A1),"line\nsecond"')).toEqual({ headers: ['Title', 'Description'], rows: [['Deal, one', 'A "quote"'], ['=SUM(A1)', 'line\nsecond']], rowNumbers: [2, 3] });
  });
  it.each(['Title,Value\n"unclosed,1', 'Title,Value\nExtra,1,2', 'Title,Title\nA,B'])('rejects malformed CSV: %s', text => expect(() => parseCsv(text)).toThrow());
  it.each<Record<string, string>>([{ size: 'unknown' }, { website: 'javascript:alert(1)' }, { name: 'bad\u0000name' }])('rejects invalid Account fields %o', patch => {
    expect(validateRow(accountImportConfig, { name: 'Company', ...patch }, 2).isValid).toBe(false);
  });
  it('normalizes valid rows and allows text beginning with formula characters as data', () => {
    const row = validateRow(accountImportConfig, { name: ' =Plain data ' }, 2);
    expect(row.isValid).toBe(true); expect(row.data.name).toBe('=Plain data');
  });
  it('rejects retired Account product input', () => {
    expect(validateRow(accountImportConfig, { name: 'Company', productInterest: 'Biometrics' }, 2).isValid).toBe(false);
  });
  it('registers only the three active importers and rejects the retired module', () => {
    for (const registry of [IMPORT_CONFIGS, importRowSchemas, importRequiredFields]) {
      expect(Object.keys(registry).sort()).toEqual(['accounts', 'contacts', 'leads']);
    }
    expect(() => getImportConfig('deals')).toThrow('Import configuration not found');
    // @ts-expect-error Deals are not part of the active shared import contract.
    const retired: CrmImportModule = 'deals';
    expect(() => mapImportCsv(retired, { fileName: 'test.csv', csvText: 'name\nCompany', mappings: { name: 0 }, idempotencyKey: crypto.randomUUID() })).toThrow('Unsupported CRM import module');
  });
});
