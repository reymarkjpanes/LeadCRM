import { afterEach, expect, it, vi } from 'vitest';
import { isAllowlistedDevelopmentGmail, isAllowlistedProductionGmail, requireEmployeeAccount } from '../account-access';
afterEach(() => vi.unstubAllEnvs());
it.each(['tironjulieann10@gmail.com', 'reymarkjpanes@gmail.com'])('requires explicit independent production approval for %s', email => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('LEADCRM_TEST_AUTH_ENABLED', 'true');
  vi.stubEnv('LEADCRM_TEST_EMAIL_ALLOWLIST', email);
  vi.stubEnv('LEADCRM_PRODUCTION_EMAIL_ALLOWLIST', 'tironjulieann10@gmail.com,reymarkjpanes@gmail.com');
  vi.stubEnv('LEADCRM_PRODUCTION_AUTH_ENABLED', 'false');
  expect(() => requireEmployeeAccount({ email, role: 'Client Admin' })).toThrow();
  vi.stubEnv('LEADCRM_PRODUCTION_AUTH_ENABLED', 'true');
  expect(isAllowlistedDevelopmentGmail(email)).toBe(false);
  expect(isAllowlistedProductionGmail(email)).toBe(true);
  expect(() => requireEmployeeAccount({ email, role: 'Client Admin' })).not.toThrow();
  expect(() => requireEmployeeAccount({ email, role: 'Guest' })).toThrow();
  for (const rejected of ['other@gmail.com', 'tironjulieann10+alias@gmail.com', 'reymark.jpanes@gmail.com', 'reymarkjpanes@gmail.com.attacker.test']) {
    expect(isAllowlistedProductionGmail(rejected)).toBe(false);
  }
  vi.stubEnv('LEADCRM_PRODUCTION_EMAIL_ALLOWLIST', '*@gmail.com');
  expect(isAllowlistedProductionGmail(email)).toBe(false);
  expect(isAllowlistedProductionGmail('*@gmail.com')).toBe(false);
});
it.each(['development', 'test', 'staging', 'preview', ''])('never uses production settings in %s', environment => {
  vi.stubEnv('NODE_ENV', environment);
  vi.stubEnv('LEADCRM_PRODUCTION_AUTH_ENABLED', 'true');
  vi.stubEnv('LEADCRM_PRODUCTION_EMAIL_ALLOWLIST', 'allowed@gmail.com');
  expect(isAllowlistedProductionGmail('allowed@gmail.com')).toBe(false);
});
it.each(['production', 'staging', 'preview', ''])('fails closed for environment %s', environment => {
  vi.stubEnv('NODE_ENV', environment); vi.stubEnv('LEADCRM_TEST_AUTH_ENABLED', 'true');
  vi.stubEnv('LEADCRM_TEST_EMAIL_ALLOWLIST', 'allowed@gmail.com');
  expect(isAllowlistedDevelopmentGmail('allowed@gmail.com')).toBe(false);
});
it.each(['development', 'test'])('uses an exact normalized entry in %s', environment => {
  vi.stubEnv('NODE_ENV', environment); vi.stubEnv('LEADCRM_TEST_AUTH_ENABLED', 'true');
  vi.stubEnv('LEADCRM_TEST_EMAIL_ALLOWLIST', 'first@gmail.com, ALLOWED@gmail.com ');
  expect(isAllowlistedDevelopmentGmail(' Allowed@Gmail.com ')).toBe(true);
  for (const email of ['allowed+alias@gmail.com', 'a.llowed@gmail.com', 'other@gmail.com', 'allowed@gmail.com.attacker.test']) {
    expect(isAllowlistedDevelopmentGmail(email)).toBe(false);
  }
});
it('never interprets or accepts a wildcard address', () => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('LEADCRM_TEST_AUTH_ENABLED', 'true');
  vi.stubEnv('LEADCRM_TEST_EMAIL_ALLOWLIST', '*@gmail.com');
  expect(isAllowlistedDevelopmentGmail('other@gmail.com')).toBe(false);
  expect(isAllowlistedDevelopmentGmail('*@gmail.com')).toBe(false);
});
