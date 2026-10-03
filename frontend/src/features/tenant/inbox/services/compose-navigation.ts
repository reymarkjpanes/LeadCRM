import { CrmEmailSchema } from '@leadcrm/shared';

export function leadEmailComposeHref(email: string): string | null {
  if (!CrmEmailSchema.safeParse(email).success) return null;
  return `/inbox?${new URLSearchParams({ compose: 'lead-email', to: email })}`;
}

/** Consume only an explicit Lead action, preserving unrelated Inbox query state. */
export function consumeLeadEmailCompose(url: URL): { to: string | null; url: URL } | null {
  if (url.searchParams.get('compose') !== 'lead-email') return null;
  const email = url.searchParams.get('to') ?? '';
  url.searchParams.delete('compose');
  url.searchParams.delete('to');
  return { to: CrmEmailSchema.safeParse(email).success ? email : null, url };
}
