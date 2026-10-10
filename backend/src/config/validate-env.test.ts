import { expect, it } from 'vitest';
import { validateEnvironment } from './validate-env';

const production = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://example.invalid/db', JWT_SECRET: 'test-only',
  BREVO_API_KEY: 'xkeysib-test-only-placeholder', BREVO_FROM_EMAIL: 'sender@example.com',
  APP_URL: 'https://app.example.com', ALLOWED_ORIGINS: 'https://app.example.com',
};
it('allows core configuration without optional integration credentials', () => {
  expect(() => validateEnvironment(production)).not.toThrow();
});
it.each(['DATABASE_URL', 'JWT_SECRET', 'BREVO_API_KEY', 'BREVO_FROM_EMAIL', 'APP_URL', 'ALLOWED_ORIGINS'])('rejects missing production %s', key => {
  expect(() => validateEnvironment({ ...production, [key]: '' })).toThrow(key);
});
it.each(['*', 'http://localhost:3000', 'https://app.example.com/login', 'https://app.example.com,'])('rejects invalid production origins', ALLOWED_ORIGINS => {
  expect(() => validateEnvironment({ ...production, ALLOWED_ORIGINS })).toThrow('ALLOWED_ORIGINS');
});
it('allows local URLs and optional email during development', () => {
  expect(() => validateEnvironment({ NODE_ENV: 'development', DATABASE_URL: 'test', JWT_SECRET: 'test', APP_URL: 'http://localhost:3000' })).not.toThrow();
});
it('requires an HTTPS callback but no Pub/Sub configuration for production Gmail', () => {
  expect(() => validateEnvironment({ ...production, GMAIL_CLIENT_ID: 'configured' })).toThrow('GMAIL_REDIRECT_URI');
  const gmail = { ...production, GMAIL_CLIENT_ID: 'configured', GMAIL_REDIRECT_URI: 'https://api.example.com/api/v1/integrations/gmail/callback' };
  expect(() => validateEnvironment(gmail)).not.toThrow();
  expect(() => validateEnvironment({ ...gmail, GMAIL_REDIRECT_URI: 'http://localhost:4000/api/v1/integrations/gmail/callback' })).toThrow('GMAIL_REDIRECT_URI');
});
it.each(['0', '5', '59', '3601', 'NaN', '60.5'])('rejects unsafe Gmail sync interval %s', GMAIL_SYNC_INTERVAL_SECONDS => {
  expect(() => validateEnvironment({ ...production, GMAIL_SYNC_INTERVAL_SECONDS })).toThrow('GMAIL_SYNC_INTERVAL_SECONDS');
});
it.each(['60', '300', '3600'])('accepts bounded Gmail sync interval %s', GMAIL_SYNC_INTERVAL_SECONDS => {
  expect(() => validateEnvironment({ ...production, GMAIL_SYNC_INTERVAL_SECONDS })).not.toThrow();
});
