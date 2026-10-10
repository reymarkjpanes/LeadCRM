import { z } from 'zod';
import { mailConfig } from '../../config/mail.config';
import { normalizeEmail } from './engagement-rules';

type StaffIdentity = { userId: string; tenantId: string; email: string };
const testOverrideSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  staffEmail: z.string().trim().email().transform(value => value.toLowerCase()),
  mailboxEmail: z.string().trim().email().transform(value => value.toLowerCase()),
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

/** One explicitly configured test mailbox; invalid or expired configuration grants no exception. */
export function getMailboxTestOverride(user: StaffIdentity, now = Date.now()) {
  try {
    const parsed = testOverrideSchema.safeParse(JSON.parse(mailConfig.gmail.testMailboxOverride));
    if (!parsed.success) return null;
    const entry = parsed.data, start = Date.parse(entry.startsAt), end = Date.parse(entry.expiresAt);
    if (start > now || end <= now || end <= start || end - start > 7 * 86400000) return null;
    if (entry.userId !== user.userId || entry.tenantId !== user.tenantId || entry.staffEmail !== normalizeEmail(user.email)) return null;
    return entry;
  } catch { return null; }
}

export function isMailboxOwner(user: StaffIdentity, mailboxEmail: string) {
  return normalizeEmail(mailboxEmail) === normalizeEmail(user.email)
    || getMailboxTestOverride(user)?.mailboxEmail === normalizeEmail(mailboxEmail);
}
