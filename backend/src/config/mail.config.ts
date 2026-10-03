export const mailConfig = {
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID ?? '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET ?? '',
    redirectUri: process.env.GMAIL_REDIRECT_URI ?? '',
    testMailboxOverride: process.env.GMAIL_TEST_MAILBOX_OVERRIDE ?? '',
  },
} as const;
