import { describe, expect, it } from 'vitest';
import { mapImportCsv, normalizeAccountImportRow, resolveAccountImportMappings } from '@leadcrm/shared';
import { accountImportConfig } from '../configs/account-import.config';
import { autoMapColumns } from './auto-mapper';
import { validateRow } from './row-validator';

const input = (csvText: string, mappings: Record<string, number>) => ({ csvText, mappings, fileName: 'accounts.csv', idempotencyKey: crypto.randomUUID() });
const fields = [...accountImportConfig.requiredFields, ...accountImportConfig.optionalFields];
describe('Accounts CSV address compatibility', () => {
  it('has exactly the five supported fields in template order', () => {
    expect(fields.map(field => field.label)).toEqual(['Company Name', 'Industry', 'Website', 'Full Address', 'Company Size']);
    expect(fields.filter(field => field.required).map(field => field.key)).toEqual(['name']);
    expect(fields.map(field => field.key)).toEqual(['name', 'industry', 'website', 'address', 'size']);
  });
  it('automatically preserves the old nine-column template with only canonical mappings', () => {
    const headers = ['Company Name', 'Product Interest', 'Industry', 'Website', 'Full Address', 'City', 'Province / State', 'Country', 'Company Size'];
    const mapped = autoMapColumns(accountImportConfig, headers.map((name, index) => ({ name, index })));
    expect(mapped).not.toHaveProperty('city');
    const mappings = Object.fromEntries(Object.entries(mapped).filter(([, value]) => value.csvColumnIndex !== null).map(([key, value]) => [key, value.csvColumnIndex!]));
    const [raw] = mapImportCsv('accounts', input(headers.join(',') + '\nAcme,Biometrics,IT,https://example.test,10 Street,Toronto,Ontario,Canada,1-10', mappings));
    const row = validateRow(accountImportConfig, raw.data, raw.rowNumber);
    expect(row.isValid).toBe(true);
    expect(row.data).toMatchObject({ address: '10 Street, Toronto, Ontario, Canada', size: '1-10' });
    expect(row.data).not.toHaveProperty('productInterest');
    for (const key of ['city', 'province', 'country']) expect(row.data).not.toHaveProperty(key);
  });
  it.each([
    ['Name,Town,State,Nation\nAcme,Makati,Metro Manila,Philippines', 'Makati, Metro Manila, Philippines'],
    ['Name,Country\nAcme,Philippines', 'Philippines'],
    ['Name,City,Country\nAcme,,Canada', 'Canada'],
    ['Name,Country\nAcme,', ''],
    ['Name,Full Address,City,Province,Country\nAcme,"42 Street\nToronto; Ontario, CANADA",Toronto,Ontario,Canada', '42 Street\nToronto; Ontario, CANADA'],
  ])('preserves legacy address data: %s', (csvText, address) => {
    const mappings: Record<string, number> = csvText.includes('Full Address') ? { name: 0, address: 1 } : { name: 0 };
    const [row] = mapImportCsv('accounts', input(csvText, mappings));
    expect(validateRow(accountImportConfig, row.data, row.rowNumber).data.address).toBe(address);
  });
  it('honors explicit legacy mappings and never consumes a claimed column twice', () => {
    expect(resolveAccountImportMappings(['Name', 'City', 'Town'], { name: 0, city: 2 })).toEqual({ name: 0, city: 2 });
    expect(resolveAccountImportMappings(['Name', 'City', 'Country'], { name: 0, industry: 1 })).toEqual({ name: 0, industry: 1, country: 2 });
    expect(() => resolveAccountImportMappings(['Name', 'City', 'Town'], { name: 0 })).toThrow('Ambiguous');
    expect(() => mapImportCsv('accounts', input('Name,City\nAcme,Manila', { name: 0, address: 1, city: 1 }))).toThrow('mapped once');
  });
  it('retains source validation limits and never truncates a valid composed address', () => {
    expect(validateRow(accountImportConfig, { name: 'Acme', city: 'X'.repeat(101) }, 2).isValid).toBe(false);
    expect(validateRow(accountImportConfig, { name: 'Acme', address: 'X'.repeat(501) }, 2).isValid).toBe(false);
    expect(validateRow(accountImportConfig, { name: 'Acme', country: 'bad\u0000value' }, 2).isValid).toBe(false);
    const source = { name: 'Acme', address: 'A'.repeat(194), city: 'B'.repeat(100), province: 'C'.repeat(100), country: 'D'.repeat(100) };
    const row = validateRow(accountImportConfig, source, 2);
    expect(row.isValid).toBe(true);
    expect(row.data.address).toBe(normalizeAccountImportRow(source).address);
    expect(row.data.address).toHaveLength(500);
    const overLimit = { ...source, address: 'A'.repeat(195) };
    const invalid = validateRow(accountImportConfig, overLimit, 2);
    expect(invalid.isValid).toBe(false);
    expect(invalid.errors).toContain('address: Address must not exceed 500 characters.');
    expect(invalid.data).toEqual(overLimit);
  });
  it('does not append duplicates or inject a country', () => {
    expect(normalizeAccountImportRow({ address: '123 Street, Manila', city: 'Manila', province: 'MANILA' }).address).toBe('123 Street, Manila');
    expect(normalizeAccountImportRow({ address: '123 Manilaville Road', city: 'Manila' }).address).toBe('123 Manilaville Road, Manila');
    expect(normalizeAccountImportRow({ address: 'Paris, France' }).address).toBe('Paris, France');
  });
});
