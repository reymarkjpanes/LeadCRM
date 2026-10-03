import { expect, it } from 'vitest';
import { safeMailboxHtml } from './email-html';
it('removes active content, tracking pixels and CSS from untrusted email', () => {
  const clean = safeMailboxHtml('<p style="background:url(https://tracker.test)">Hello</p><img src="https://tracker.test/open" onerror="alert(1)"><svg onload="alert(1)"></svg><a href="jav&#97;script:alert(1)">link</a><script>alert(1)</script>');
  expect(clean).toContain('Hello'); expect(clean).not.toMatch(/script|onerror|onload|tracker|style=|<svg|<img/);
  expect(safeMailboxHtml('<a href="https://example.test">Product</a>')).toContain('href="https://example.test"');
});
