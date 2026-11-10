import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPasswordResetEmail, buildProfileEmailChangeEmail, buildWelcomeCredentialsEmail } from '../auth-email.templates';
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
  it('brands email-change verification with selectable escaped code and the fixed 15-minute lifetime', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-02-01T00:00:00Z'));
    vi.stubEnv('PASSWORD_RESET_TTL_MINUTES', '25');
    const html = buildProfileEmailChangeEmail('<synthetic&code>');
    expect(html).toContain('>Confirm your LeadCRM email address</h1>');
    expect(html).toContain('src="https://lead-crm.tech/leadcrm_logo.png"');
    expect(html).toContain('Camxian Technologies');
    expect(html).toContain('font-family:Arial, Helvetica, sans-serif');
    expect(html).toContain('font-family:monospace');
    expect(html).toContain('word-break:break-all');
    expect(html).toContain('<strong>&lt;synthetic&amp;code&gt;</strong>');
    expect(html).not.toContain('<synthetic&code>');
    expect(html).toContain('Enter the verification code below in Profile Settings');
    expect(html).toContain('This code expires in 15 minutes.');
    expect(html).toContain('You can safely ignore this email. Your account email address will stay unchanged unless you verify the change.');
    expect(html).toContain('The LeadCRM team');
    for (const path of ['/privacy-policy', '/terms-of-service', '/help']) expect(html).toContain(`href="https://lead-crm.tech${path}"`);
    expect(html).toContain('href="mailto:leadcrm.tech@gmail.com"');
    expect(html).toContain('&copy; 2027 LeadCRM &middot; Camxian Technologies');
    expect(html).not.toMatch(/reset-password|Reset password|This link expires|<button|<script|<svg/);
  });
  it('centers a six-digit code without altering leading zeros or inserting spaces', () => {
    const html = buildProfileEmailChangeEmail('000042');
    expect(html).toContain('<strong>000042</strong>');
    expect(html).toContain('align="center" style="padding:18px 20px;font-family:monospace;font-size:32px;letter-spacing:6px');
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
