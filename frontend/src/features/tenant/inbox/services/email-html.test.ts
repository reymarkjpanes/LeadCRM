import { expect, it } from 'vitest';
import { safeMailboxHtml, trimmedMailboxHtml } from './email-html';
it('removes active content, tracking pixels and CSS from untrusted email', () => {
  const clean = safeMailboxHtml('<p style="background:url(https://tracker.test)">Hello</p><img src="https://tracker.test/open" onerror="alert(1)"><svg onload="alert(1)"></svg><a href="jav&#97;script:alert(1)">link</a><script>alert(1)</script>');
  expect(clean).toContain('Hello'); expect(clean).not.toMatch(/script|onerror|onload|tracker|style=|<svg|<img/);
  expect(safeMailboxHtml('<a href="https://example.test">Product</a>')).toContain('href="https://example.test"');
});
it('contains sender markup and restricts navigation without hiding ambiguous customer text', () => {
  const html = '<div class="fixed inset-0" style="position:fixed"><iframe src="https://tracker.test"></iframe><object>bad</object><embed src="x"><a href="/crm/leads">internal path</a><a href="data:text/html,bad">data</a><a href="https://example.test" onclick="bad()">safe</a></div>';
  const clean = safeMailboxHtml(html);
  expect(clean).not.toMatch(/class=|style=|iframe|object|embed|onclick|href="\/|data:/);
  expect(clean).toContain('rel="noopener noreferrer"'); expect(clean).toContain('target="_blank"');
  expect(trimmedMailboxHtml('<p>On Thursday we wrote a proposal.</p>')).not.toContain('<details');
  expect(trimmedMailboxHtml('<p>Reply</p><blockquote>History</blockquote><p>Answer after quote</p>')).toContain('</details><p>Answer after quote</p>');
});
