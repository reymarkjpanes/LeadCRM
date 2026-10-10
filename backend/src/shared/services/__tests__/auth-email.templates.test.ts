import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPasswordResetEmail, buildWelcomeCredentialsEmail } from '../auth-email.templates';
import { getAuthAppOrigin, getPasswordResetTtlMinutes } from '../../helpers/auth-email-config';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_URL', 'https://lead-crm.tech');
  vi.stubEnv('PASSWORD_RESET_TTL_MINUTES', '60');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('shared authentication templates', () => {
  it.each([
    ['reset', () => buildPasswordResetEmail('https://lead-crm.tech/reset-password?token=synthetic', '<Julie & Ann>')],
    ['welcome', () => buildWelcomeCredentialsEmail({ firstName: '<Julie & Ann>', lastName: 'Tiron', email: 'staff@camxian.com' }, '<synthetic&credential>')],
  ])('renders escaped %s content and canonical public footer destinations', (_name, build) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-02-01T00:00:00Z'));
    const html = build();
    for (const path of ['/privacy-policy', '/terms-of-service', '/help']) expect(html).toContain(`href="https://lead-crm.tech${path}"`);
    expect(html).toContain('href="mailto:leadcrm.tech@gmail.com"');
    expect(html).toContain('&copy; 2027 LeadCRM &middot; Camxian Technologies');
    expect(html).toContain('Hi &lt;Julie &amp; Ann&gt;,');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('width="50" height="50"');
    expect(html).not.toMatch(/support@leadcrm\.io|sendibt3|vercel\.app|linear-gradient|<svg|<script|\{\{/);
  });
  it('retains login and plaintext credential only in the escaped welcome message', () => {
    const html = buildWelcomeCredentialsEmail({ firstName: 'Julie Ann', lastName: 'Tiron', email: 'staff@camxian.com' }, '<synthetic&credential>');
    expect(html).toContain('&lt;synthetic&amp;credential&gt;');
    expect(html).not.toContain('<synthetic&credential>');
    expect(html).toContain('href="https://lead-crm.tech/login"');
    expect(html).toContain('the first time you sign in');
  });
  it('uses the configured expiry and exactly the same reset URL for CTA and fallback', () => {
    vi.stubEnv('PASSWORD_RESET_TTL_MINUTES', '25');
    const html = buildPasswordResetEmail('https://lead-crm.tech/reset-password?token=a%26b', 'Julie Ann');
    expect(html).toContain('This link expires in 25 minutes.');
    expect(html.match(/href="https:\/\/lead-crm.tech\/reset-password\?token=a%26b"/g)).toHaveLength(2);
  });
  it.each(['https://evil.example/reset-password?token=synthetic', 'javascript:alert(1)', 'https://lead-crm.tech/login?token=x', 'https://lead-crm.tech/reset-password', 'https://user:secret@lead-crm.tech/reset-password?token=x', 'https://lead-crm.tech/reset-password?token=x&next=https://evil.example', 'https://lead-crm.tech/reset-password?token=x&token=y'])('rejects an invalid destination without including it in the error', value => {
    expect(() => buildPasswordResetEmail(value)).toThrow('Invalid password reset destination.');
  });
  it.each(['http://lead-crm.tech', 'https://lead-crm.tech/path', 'https://user:secret@lead-crm.tech', 'https://lead-crm.tech?next=x', '', 'https://localhost'])('rejects invalid production APP_URL configuration', value => {
    vi.stubEnv('APP_URL', value);
    expect(() => getAuthAppOrigin()).toThrow(/APP_URL/);
  });
  it.each(['0', '-1', 'NaN', '2.5', '60junk'])('rejects invalid reset lifetime %s', value => {
    vi.stubEnv('PASSWORD_RESET_TTL_MINUTES', value);
    expect(() => getPasswordResetTtlMinutes()).toThrow(/PASSWORD_RESET_TTL_MINUTES/);
  });
});
