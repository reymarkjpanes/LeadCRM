import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv-parser';
import { validateRow } from './row-validator';
import { dealImportConfig } from '../configs/deal-import.config';

describe('CSV parsing and deal validation', () => {
  it('preserves quoted commas, escaped quotes, newlines and formula-like plain text', () => {
    expect(parseCsv('Title,Description\r\n"Deal, one","A ""quote"""\r\n=SUM(A1),"line\nsecond"')).toEqual({ headers: ['Title', 'Description'], rows: [['Deal, one', 'A "quote"'], ['=SUM(A1)', 'line\nsecond']], rowNumbers: [2, 3] });
  });
  it.each(['Title,Value\n"unclosed,1', 'Title,Value\nExtra,1,2', 'Title,Title\nA,B'])('rejects malformed CSV: %s', text => expect(() => parseCsv(text)).toThrow());
  it.each<Record<string, string>>([{ value: 'Infinity' }, { value: 'NaN' }, { value: '-1' }, { value: '1e9' }, { priority: 'urgent' }, { expectedCloseDate: '2026-02-30' }, { title: 'bad\u0000title' }])('rejects invalid deal fields %o', patch => {
    expect(validateRow(dealImportConfig, { title: 'Deal', pipeline: 'Sales', stage: 'Lead', ...patch }, 2).isValid).toBe(false);
  });
  it('normalizes valid rows and allows text beginning with formula characters as data', () => {
    const row = validateRow(dealImportConfig, { title: ' =Plain data ', pipeline: 'Sales', stage: 'Lead', productInterest: 'Biometrics', priority: 'high', expectedCloseDate: '2028-02-29' }, 2);
    expect(row.isValid).toBe(true); expect(row.data.title).toBe('=Plain data'); expect(row.data.priority).toBe('HIGH');
  });
});
