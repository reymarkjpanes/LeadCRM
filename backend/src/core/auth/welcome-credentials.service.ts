import { buildWelcomeCredentialsEmail, sendMail } from '../../shared/services/email.service';

/** The credential is consumed only by the mail transport and is never logged or returned. */
export async function sendWelcomeCredentials(user: { firstName: string; lastName: string; email: string }, temporaryPassword: string): Promise<boolean> {
  try {
    const result = await sendMail({
      to: user.email, subject: 'Welcome to LeadCRM', requireDelivery: true,
      html: buildWelcomeCredentialsEmail(user, temporaryPassword),
    });
    return result.submitted === true;
  } catch {
    // sendMail records only safe provider metadata. Account creation already committed.
    return false;
  }
}
