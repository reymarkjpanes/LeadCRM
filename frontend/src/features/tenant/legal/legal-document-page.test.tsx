import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import LegalDocumentPage, { legalMetadata } from './legal-document-page';
import { privacyPolicy, termsOfService, LEGAL_ORGANIZATION } from './legal-documents';
import PublicSupportPage from './public-support-page';

afterEach(cleanup);
describe('public legal documents without an authentication provider', () => {
  it.each([[privacyPolicy, 17], [termsOfService, 20]] as const)('renders every section of $title with accurate organization information', (document, count) => {
    const { container } = render(<LegalDocumentPage document={document} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(container.querySelectorAll('article section')).toHaveLength(count);
    for (const section of document.sections) expect(screen.getByRole('heading', { name: `${section.number}. ${section.title}`, level: 2 })).toBeTruthy();
    expect(container.textContent).toContain(LEGAL_ORGANIZATION.address);
    expect(container.textContent).toContain('LeadCRM Development Team (Student Capstone Project)');
    expect(container.textContent).not.toMatch(/\[To be confirmed\]|Camxian Technologies Development Team|dpo@|privacy@leadcrm|8888|GDPR/);
    expect(legalMetadata(document).alternates?.canonical).toBe(`https://lead-crm.tech${document.path}`);
    expect(screen.getByRole('complementary', { name: 'Document review status' })).toBeTruthy();
    for (const [label, href] of [['Privacy Policy', '/privacy-policy'], ['Terms of Service', '/terms-of-service'], ['Help Center', '/help']]) {
      expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
    }
  });
  it('preserves the IP agreement boundary and requires expressly permitted maintenance', () => {
    const { container } = render(<LegalDocumentPage document={termsOfService} />);
    expect(container.textContent).toContain('Ownership of software, source code, branding, and related intellectual property remains subject to applicable employment, development, licensing, and other agreements.');
    expect(container.textContent).toContain('where expressly permitted');
    expect(container.textContent).toContain('does not automatically own company records');
  });
  it('links support to the public Help Center', () => {
    render(<PublicSupportPage />);
    expect(screen.getByRole('link', { name: 'Open Help Center' }).getAttribute('href')).toBe('/help');
    expect(screen.getAllByRole('link', { name: 'leadcrm.tech@gmail.com' }).every(link => link.getAttribute('href') === 'mailto:leadcrm.tech@gmail.com')).toBe(true);
  });
  it('escapes document text instead of accepting HTML', () => {
    const { container } = render(<LegalDocumentPage document={{ ...termsOfService, sections: [{ number: 1, title: 'Safety', blocks: [{ type: 'paragraph', text: '<script>alert(1)</script>' }] }] }} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});
