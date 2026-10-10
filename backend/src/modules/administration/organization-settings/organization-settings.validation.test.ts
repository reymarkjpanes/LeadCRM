import { describe, expect, it } from 'vitest';
import { UpdateOrganizationSettingsSchema, ORGANIZATION_FIELD_LIMITS, COMPANY_INDUSTRIES, formatOrganizationPhone } from '@leadcrm/shared';
describe('organization settings input contract', () => {
  it.each([
    ['name', ''], ['name', '  '], ['name', 'a'.repeat(151)], ['name', '<script>bad</script>'],
    ['email', ''], ['email', null], ['email', '   '], ['email', 'abc'], ['email', 'abc@'], ['email', '@camxian.com'], ['email', 'abc..test@camxian.com'], ['email', 'a'.repeat(245) + '@camxian.com'],
    ['industry', 'Unsupported'], ['domain', 'not a domain'], ['domain', 'https://camxian.com'], ['domain', 'http://camxian.com'], ['domain', 'camxian.com/settings'], ['domain', 'camxian..com'], ['domain', '-camxian.com'], ['domain', 'user@camxian.com'], ['domain', 'camxian'], ['domain', 'x'.repeat(254)],
    ['address', '   '], ['address', 'a'.repeat(501)], ['address', '\u0000'],
    ['phone', '+639123456789'], ['phone', '+1 281233488'], ['phone', '(31) 123-4567'], ['phone', '(28 123-3488'], ['phone', '(28) 1-2-3-3-4-8-8'], ['phone', '28123348899'], ['phone', 'abc'],
  ])('rejects invalid %s value %s', (field, value) => {
    const result = UpdateOrganizationSettingsSchema.safeParse({ [field as string]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty(field as string);
  });
  it('normalizes valid input without truncating business names or address punctuation', () => {
    expect(UpdateOrganizationSettingsSchema.parse({ name: '  A&B Trading Co., Inc.  ', email: ' Info@Camxian.com ', industry: 'Technology', phone: '+63 (28) 123-3488', domain: ' Camxian.COM ', address: ' Unit #5, 123 Main St. ' })).toEqual({ name: 'A&B Trading Co., Inc.', email: 'info@camxian.com', industry: 'Technology', phone: '+63281233488', domain: 'camxian.com', address: 'Unit #5, 123 Main St.' });
    expect(formatOrganizationPhone('+63281233488')).toBe('(28) 123-3488');
    expect(UpdateOrganizationSettingsSchema.parse({ address: '  Unit #5, Main St.\nManila  ' }).address).toBe('Unit #5, Main St.\nManila');
    for (const industry of COMPANY_INDUSTRIES) expect(UpdateOrganizationSettingsSchema.safeParse({ industry }).success).toBe(true);
    expect(UpdateOrganizationSettingsSchema.safeParse({ name: 'x'.repeat(ORGANIZATION_FIELD_LIMITS.name), address: 'x'.repeat(ORGANIZATION_FIELD_LIMITS.address) }).success).toBe(true);
    for (const phone of ['(28) 123-3488', '02 8123 3488', '+63281233488', '(32) 123-4567']) expect(UpdateOrganizationSettingsSchema.safeParse({ phone }).success).toBe(true);
  });
});
