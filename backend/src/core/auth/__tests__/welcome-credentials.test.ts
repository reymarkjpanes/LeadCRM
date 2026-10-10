import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../shared/services/email.service', async importOriginal => ({
  ...await importOriginal<typeof import('../../../shared/services/email.service')>(), sendMail: vi.fn(),
}));
import { generateTemporaryPassword } from '../temporary-password';
import { sendWelcomeCredentials } from '../welcome-credentials.service';
import { sendMail, buildWelcomeCredentialsEmail } from '../../../shared/services/email.service';
const user = { firstName: ' Julie Ann ', lastName: ' Tiron ', email: 'example@camxian.com' };
afterEach(() => vi.restoreAllMocks());

it('normalizes readable names and securely generates exactly two digits within the bcrypt byte limit', () => {
  expect(generateTemporaryPassword(user.firstName, user.lastName)).toMatch(/^julieann\.tiron\d{2}$/);
  expect(generateTemporaryPassword(' Réy Mark! ', " O'Panes ")).toMatch(/^reymark\.opanes\d{2}$/);
  expect(generateTemporaryPassword('', '!!!')).toMatch(/^user\.account\d{2}$/);
  expect(Buffer.byteLength(generateTemporaryPassword('x'.repeat(100), 'y'.repeat(100)))).toBeLessThanOrEqual(72);
});
it('escapes credential email content and uses the branded welcome template', () => {
  const html = buildWelcomeCredentialsEmail({ firstName: '<Alice>', lastName: 'Test', email: 'alice@camxian.com' }, 'first.last42');
  expect(html).toContain('&lt;Alice&gt;');
  expect(html).not.toContain('<Alice>');
  expect(html).toContain('first.last42');
  expect(html).toContain('/login');
  expect(html).toContain('LeadCRM');
});
it.each([true, false])('only reports credentials submitted when the provider confirms %s', async submitted => {
  vi.mocked(sendMail).mockResolvedValue({ submitted, messageId: submitted ? 'provider-id' : '' });
  expect(await sendWelcomeCredentials(user, 'first.last42')).toBe(submitted);
  expect(sendMail).toHaveBeenLastCalledWith(expect.objectContaining({ to: user.email, subject: 'Welcome to LeadCRM', requireDelivery: true }));
});
it.each(['provider rejection', 'network failure'])('handles %s without logging the temporary credential', async reason => {
  const log = vi.spyOn(console, 'log');
  const error = vi.spyOn(console, 'error');
  vi.mocked(sendMail).mockRejectedValue(new Error(reason));
  expect(await sendWelcomeCredentials(user, 'first.last42')).toBe(false);
  expect(log).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
