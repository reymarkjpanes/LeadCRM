import DOMPurify from 'dompurify';

function mailboxFragment(html: string) {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    // Classes are inspected for provider quote markers, then removed before rendering.
    ALLOWED_ATTR: ['href', 'title', 'class'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true,
  });
  fragment.querySelectorAll('a').forEach(link => {
    if (!/^(https?:\/\/|mailto:)/i.test(link.getAttribute('href') ?? '')) link.removeAttribute('href');
    else { link.setAttribute('rel', 'noopener noreferrer'); link.setAttribute('target', '_blank'); }
  });
  return fragment;
}
function serialize(fragment: DocumentFragment) {
  fragment.querySelectorAll('[class]').forEach(element => element.removeAttribute('class'));
  const container = document.createElement('div'); container.append(fragment);
  return container.innerHTML;
}

/** Mail is untrusted: no remote resources, CSS, executable elements or unsafe links. */
export function safeMailboxHtml(html: string): string { return serialize(mailboxFragment(html)); }

/** Only structural quotes are folded; original content and ordering remain intact.
 * Unknown plaintext separators deliberately remain visible. */
export function trimmedMailboxHtml(html: string): string {
  const fragment = mailboxFragment(html);
  const selector = 'blockquote, .gmail_quote';
  const quotes = [...fragment.querySelectorAll(selector)].filter(element => !element.parentElement?.closest(selector));
  for (const quote of quotes) {
    if (!quote.textContent?.trim()) continue;
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Show trimmed content';
    quote.replaceWith(details); details.append(summary, quote);
  }
  return serialize(fragment);
}
