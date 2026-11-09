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

/** Compatibility helper for the app-DOM rendering policy. */
export function trimmedMailboxHtml(html: string): string {
  return safeMailboxHtml(normalizeMailboxContent(html).html);
}

export const mailboxContentId = (value: string) => {
  try { return decodeURIComponent(value.replace(/^cid:/i, '')).trim().replace(/^<|>$/g, ''); } catch { return ''; }
};
export function mailboxReferencedContentIds(html: string): Set<string> {
  const fragment = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['img'], ALLOWED_ATTR: ['src'], RETURN_DOM_FRAGMENT: true });
  return new Set([...fragment.querySelectorAll('img[src]')].flatMap(img => /^cid:/i.test(img.getAttribute('src') ?? '') ? [mailboxContentId(img.getAttribute('src')!)] : []));
}

function mailboxDocument(html: string): HTMLElement {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true, RETURN_DOM: true,
    ALLOWED_TAGS: ['html', 'head', 'body', 'style', 'p', 'br', 'hr', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'center', 'font', 'details', 'summary'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'type', 'style', 'width', 'height', 'align', 'valign', 'bgcolor', 'background', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'size', 'face', 'color', 'dir', 'lang'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  }) as HTMLElement;
}

// Decode entity tokens only, once. Decoded angle brackets always remain text.
function decodeMailboxText(value: string): string {
  const decoder = document.createElement('textarea');
  return value.replace(/&(?:#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi, token => {
    decoder.innerHTML = token;
    return decoder.value;
  }).replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
}

type MailboxLine = { text: string; parts: { node: Text; offset: number; length: number }[] };
const blockElement = /^(?:P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TFOOT|TR|HR)$/;

/** Logical lines retain text-node positions so cleanup does not flatten links or formatting. */
function mailboxLines(root: Element): MailboxLine[] {
  const lines: MailboxLine[] = [];
  let line: MailboxLine = { text: '', parts: [] };
  const finish = (force = false) => {
    if (force || line.parts.length) lines.push(line);
    line = { text: '', parts: [] };
  };
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const value = node.textContent ?? '';
      let offset = 0;
      value.split('\n').forEach((part, index) => {
        if (index) { line.parts.push({ node: node as Text, offset: offset - 1, length: 1 }); finish(true); }
        line.text += part.replace(/\u00a0/g, ' ');
        line.parts.push({ node: node as Text, offset, length: part.length });
        offset += part.length + 1;
      });
    } else if (node.nodeType === 1) {
      const element = node as Element;
      if (element.matches('style, script')) return;
      if (element.tagName === 'BR') { finish(true); return; }
      if (blockElement.test(element.tagName)) finish();
      element.childNodes.forEach(visit);
      if (blockElement.test(element.tagName)) finish();
      if (element.tagName === 'P') finish(true);
      if (element.tagName === 'TD' || element.tagName === 'TH') line.text += '\t';
    }
  };
  root.childNodes.forEach(visit); finish();
  return lines;
}

const replyHeader = (text: string) => /^On\s+.{3,500}\bwrote:\s*$/i.test(text) &&
  /@|\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b|\b\d{1,4}[\/:.-]\d{1,2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(text);
const originalHeader = (text: string) => /^-{2,}\s*Original Message\s*-{2,}$/i.test(text);
const forwardHeader = (text: string) => /^(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:)$/i.test(text);
function hasMessageHeaders(lines: MailboxLine[], index: number): boolean {
  const following = lines.slice(index, index + 12).map(line => line.text.trim()).join('\n');
  return /^From:\s*\S/im.test(following) && /^(?:Date|Sent):\s*\S/im.test(following) && /^(?:To|Subject):\s*\S/im.test(following);
}

function removeMailboxQuotes(body: Element, subject: string) {
  const initial = mailboxLines(body);
  const forwardIndex = initial.findIndex((line, index) => forwardHeader(line.text.trim()) && hasMessageHeaders(initial, index + 1));
  // Outlook uses the same body header for replies and forwards; its subject disambiguates them.
  const forwarding = /^\s*fwd?:/i.test(subject);
  const outlook = forwarding ? body.querySelector('#divRplyFwdMsg') : null;
  const outlookLines = outlook ? mailboxLines(outlook) : [];
  // A forward nested inside previous reply history is still previous history.
  const forward = forwardIndex >= 0 && !initial.slice(0, forwardIndex).some(line => replyHeader(line.text.trim()) || originalHeader(line.text.trim()))
    ? initial[forwardIndex].parts.find(part => part.length)?.node
    : hasMessageHeaders(outlookLines, 0) ? outlookLines.flatMap(line => line.parts).find(part => part.length)?.node : undefined;
  const protectedForward = (element: Element) => !!element.closest('.moz-forward-container') || !!forward &&
    (element.contains(forward) || !!(forward.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));

  for (const quote of [...body.querySelectorAll('.gmail_quote, .yahoo_quoted, blockquote, #divRplyFwdMsg')]) {
    if (!body.contains(quote) || protectedForward(quote)) continue;
    const previous = quote.previousElementSibling;
    const prefix = previous?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
    if (quote.id === 'divRplyFwdMsg') {
      if (!hasMessageHeaders(mailboxLines(quote), 0)) continue;
      // Outlook's header marks the old-message suffix; a bounded blockquote keeps later answers intact.
      if (quote.nextElementSibling?.tagName === 'BLOCKQUOTE') { quote.nextElementSibling.remove(); quote.remove(); }
      else {
        const range = document.createRange(); range.setStartBefore(quote); range.setEnd(body, body.childNodes.length); range.deleteContents();
      }
    } else if (quote.matches('.gmail_quote, .yahoo_quoted, blockquote[type="cite"]') || replyHeader(prefix)) {
      if (previous && replyHeader(prefix)) previous.remove();
      quote.remove();
    }
  }

  const lines = mailboxLines(body), removed = new Set<number>();
  let quoting = false;
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].text.trim();
    if (lines[index].parts.some(part => part.node.parentElement?.closest('code, .moz-forward-container'))) continue;
    if (forward && lines[index].parts.some(part => part.node === forward || !!(forward.compareDocumentPosition(part.node) & Node.DOCUMENT_POSITION_FOLLOWING))) break;
    if (forwardHeader(text) && hasMessageHeaders(lines, index + 1)) break;
    if (originalHeader(text) && hasMessageHeaders(lines, index + 1)) {
      if (forwarding) break;
      for (let tail = index; tail < lines.length; tail++) removed.add(tail);
      break;
    }
    // Client attribution headers may wrap across several lines.
    if (/^On\s/i.test(text)) {
      for (let end = index; end < Math.min(index + 4, lines.length); end++) {
        const header = lines.slice(index, end + 1).map(line => line.text.trim()).join(' ');
        let next = end + 1;
        while (next < lines.length && !lines[next].text.trim()) next++;
        if (replyHeader(header) && /^>/.test(lines[next]?.text.trim() ?? '')) {
          for (let part = index; part <= end; part++) removed.add(part);
          quoting = true; index = end; break;
        }
      }
    }
    if (quoting && /^>/.test(text)) removed.add(index);
  }
  // Reverse edits keep offsets valid when several lines share one text node.
  [...removed].sort((a, b) => b - a).forEach(index => {
    [...lines[index].parts].reverse().forEach(part => part.node.deleteData(part.offset, part.length));
  });
}

type MailboxContentOptions = { format?: 'auto' | 'text'; subject?: string };
function normalizedMailboxDocument(body: string, { format = 'auto', subject = '' }: MailboxContentOptions = {}, preserveQuotes = false): HTMLElement {
  const envelope = format === 'auto' ? body.match(/^\s*<pre>([^<]*)<\/pre>\s*$/i) : null;
  const isHtml = format !== 'text' && /<(?:!doctype|\/?(?:html|head|body|style|p|br|hr|div|span|strong|b|em|i|u|s|h[1-6]|ul|ol|li|blockquote|pre|code|a|img|table|thead|tbody|tfoot|tr|th|td|caption|center|font|details|summary|script|iframe|svg|math|object|form))(?=[\s/>])/i.test(body);
  const root = mailboxDocument(isHtml && !envelope ? body : '');
  const content = root.querySelector('body')!;
  if (!isHtml || envelope) {
    const pre = document.createElement('pre');
    // Gmail first escapes the text/plain MIME part for transport inside <pre>.
    // Unwrap that transport layer, then decode the original textual entities once.
    pre.textContent = decodeMailboxText(envelope ? decodeMailboxText(envelope[1]) : body);
    content.append(pre);
  }
  if (!preserveQuotes) removeMailboxQuotes(content, subject);
  return root;
}

/** Display projection only. HTML must still use the existing app-DOM or iframe safety policy. */
export function normalizeMailboxContent(body: string, options: MailboxContentOptions = {}): { html: string; text: string } {
  const root = normalizedMailboxDocument(body, options);
  const text = mailboxLines(root.querySelector('body')!).map(line => line.text).join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { html: root.outerHTML, text };
}

/** Forward the complete original, including quoted history, through the composer safety policy. */
export function forwardMailboxHtml(body: string): string {
  return safeMailboxHtml(normalizedMailboxDocument(body, {}, true).querySelector('body')!.innerHTML);
}

/** Display only. This document MUST stay in a script-disabled sandbox, never the app DOM.
 * DOMPurify validates markup; the frame CSP contains CSS and resource loading. */
export function mailboxDisplayDocument(html: string, inlineImages: Record<string, string> = {}, subject = ''): string {
  const root = normalizedMailboxDocument(html, { subject });
  const body = root.querySelector('body')!;
  if (!body.textContent?.trim() && !body.querySelector('img')) {
    const empty = document.createElement('p'); empty.textContent = '(No content)'; body.replaceChildren(empty);
  }
  root.querySelectorAll('a').forEach(link => {
    if (!/^(https?:\/\/|mailto:)/i.test(link.getAttribute('href') ?? '')) link.removeAttribute('href');
    else { link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer'); }
  });
  root.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') ?? '';
    const resolved = /^cid:/i.test(src) ? inlineImages[mailboxContentId(src)] : src;
    // Only application-created blobs can enter through the CID map.
    if (resolved && (/^https?:\/\//i.test(resolved) || /^cid:/i.test(src) && /^blob:/.test(resolved))) img.setAttribute('src', resolved);
    else img.removeAttribute('src');
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.removeAttribute('srcset');
  });
  root.querySelectorAll('[background]').forEach(element => {
    if (!/^https?:\/\//i.test(element.getAttribute('background') ?? '')) element.removeAttribute('background');
  });
  const head = root.querySelector('head');
  const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: http: blob:; font-src 'self'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  head?.insertAdjacentHTML('afterbegin', `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{background:white;color:#111}body{margin:0;display:flow-root;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;margin:12px 0;font:12px sans-serif;color:#666}</style>`);
  return '<!doctype html>' + root.outerHTML;
}
