/**
 * Integration tests for panel migrations — LeadPanel, ContactPanel, AccountPanel.
 *
 * Validates that each panel renders its core sections after migration:
 * - RecordActionBar for quick actions
 * - Tasks section with InlineTaskForm support (Lead, Contact)
 * - CustomFieldsSection for extensible metadata
 * - FilesSection for file attachments (Contact, Account)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUpdateContact = vi.fn().mockResolvedValue(undefined);
const mockDeleteContact = vi.fn().mockResolvedValue(undefined);
const mockAddTask = vi.fn().mockResolvedValue(undefined);
const mockAddDeal = vi.fn().mockResolvedValue(undefined);
const mockUpdateOrganization = vi.fn().mockResolvedValue(undefined);
const mockDeleteOrganization = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/DataContext', () => ({
  useData: () => ({
    pipelines: [
      {
        id: 'pipe-1',
        name: 'Sales Pipeline',
        stages: [
          { id: 'stg-1', name: 'Prospect', order: 1, isWon: false, isLost: false },
          { id: 'stg-2', name: 'Proposal', order: 2, isWon: false, isLost: false },
          { id: 'stg-3', name: 'Won', order: 3, isWon: true, isLost: false },
        ],
      },
    ],
    tasks: [
      {
        id: 'task-1',
        title: 'Follow up call',
        status: 'pending',
        priority: 'High',
        dueDate: '2025-03-01T00:00:00.000Z',
        leadId: 'lead-1',
      },
    ],
    deals: [
      {
        id: 'deal-1',
        title: 'Security Package',
        value: 100000,
        leadId: 'lead-1',
        companyName: 'Acme Corp',
        priority: 'High',
      },
    ],
    contacts: [
      { id: 'contact-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '+639001111', accountId: 'org-1' },
    ],
    organizations: [
      { id: 'org-1', name: 'Acme Corp', industry: 'Technology', city: 'Manila' },
    ],
    users: [
      { id: 'u-1', firstName: 'Admin', lastName: 'User', email: 'admin@test.com' },
    ],
    roles: [],
    updateContact: mockUpdateContact,
    deleteContact: mockDeleteContact,
    addTask: mockAddTask,
    addDeal: mockAddDeal,
    updateOrganization: mockUpdateOrganization,
    deleteOrganization: mockDeleteOrganization,
  }),
}));

vi.mock('@/store/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', role: 'Client Admin', email: 'admin@test.com' },
  }),
}));

const mockUseHasPermission = vi.fn((_permission: string): boolean => true);
vi.mock('@/shared/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockUseHasPermission(permission),
  usePermissions: () => ['*'],
  useCanAny: () => true,
  PERMISSION_BRIDGE: {},
}));

// Mock next/link to render a plain anchor
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// ─── Import Components Under Test ─────────────────────────────────────────────

import { LeadPanel, ContactPanel, AccountPanel } from '../RecordPanelWrappers';
import type { Lead, Contact } from '@/store/types';

// ─── Test Data ────────────────────────────────────────────────────────────────

const MOCK_LEAD: Lead = {
  id: 'lead-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  phone: '+639123456',
  companyName: 'Acme Corp',
  status: 'Hot',
  source: 'Website',
  leadSource: 'Web',
  productInterests: ['Security', 'CCTV'],
  accountId: 'org-1',
  createdAt: '2025-01-15T00:00:00.000Z',
} as unknown as Lead;

const MOCK_CONTACT: Contact = {
  id: 'contact-1',
  firstName: 'Alice',
  lastName: 'Smith',
  email: 'alice@example.com',
  phone: '+639001111',
  companyName: 'Acme Corp',
  status: 'Qualified',
  accountId: 'org-1',
  createdAt: '2025-02-01T00:00:00.000Z',
} as unknown as Contact;

const MOCK_ACCOUNT = {
  id: 'org-1',
  name: 'Acme Corp',
  industry: 'Technology',
  website: 'https://acme.com',
  city: 'Manila',
  province: 'NCR',
  country: 'Philippines',
  customerType: 'Active Customer',
  createdAt: '2025-01-01T00:00:00.000Z',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Renders a panel and navigates to the "Details" tab to reveal sections */
function clickDetailsTab(): void {
  const detailsTab = screen.getByRole('tab', { name: /details/i });
  fireEvent.click(detailsTab);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LeadPanel — panel migration', () => {
  beforeEach(() => {
    mockUseHasPermission.mockImplementation((): boolean => true);
  });

  it('renders RecordActionBar section with email/phone buttons', () => {
    render(<LeadPanel open={true} onOpenChange={() => {}} lead={MOCK_LEAD} />);
    clickDetailsTab();

    // RecordActionBar renders titled buttons for the lead's email/phone
    expect(screen.getByTitle('Email john@example.com')).toBeDefined();
    expect(screen.getByTitle('Call +639123456')).toBeDefined();
  });

  it('renders Tasks section with "Task" heading text', () => {
    render(<LeadPanel open={true} onOpenChange={() => {}} lead={MOCK_LEAD} />);
    clickDetailsTab();

    // Section header for Tasks
    expect(screen.getByText('Tasks')).toBeDefined();
    // A task from the mocked data should appear
    expect(screen.getByText('Follow up call')).toBeDefined();
  });

  it('renders CustomFieldsSection in the details tab', () => {
    render(<LeadPanel open={true} onOpenChange={() => {}} lead={MOCK_LEAD} />);
    clickDetailsTab();

    // "Custom Fields" section header (may appear in tab badge too)
    const customFieldsElements = screen.getAllByText('Custom Fields');
    expect(customFieldsElements.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ContactPanel — panel migration', () => {
  beforeEach(() => {
    mockUseHasPermission.mockImplementation((): boolean => true);
  });

  it('renders RecordActionBar section with email/phone buttons', () => {
    render(<ContactPanel open={true} onOpenChange={() => {}} contact={MOCK_CONTACT} />);
    clickDetailsTab();

    expect(screen.getByTitle('Email alice@example.com')).toBeDefined();
    expect(screen.getByTitle('Call +639001111')).toBeDefined();
  });

  it('renders Tasks section', () => {
    render(<ContactPanel open={true} onOpenChange={() => {}} contact={MOCK_CONTACT} />);
    clickDetailsTab();

    expect(screen.getByText('Tasks')).toBeDefined();
  });

  it('renders CustomFieldsSection', () => {
    render(<ContactPanel open={true} onOpenChange={() => {}} contact={MOCK_CONTACT} />);
    clickDetailsTab();

    const customFieldsElements = screen.getAllByText('Custom Fields');
    expect(customFieldsElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders FilesSection', () => {
    render(<ContactPanel open={true} onOpenChange={() => {}} contact={MOCK_CONTACT} />);
    clickDetailsTab();

    // "Files" appears as both tab trigger and section header
    const filesElements = screen.getAllByText('Files');
    expect(filesElements.length).toBeGreaterThanOrEqual(1);
    // Verify at least one is a section header (h3)
    const sectionHeader = filesElements.find((el) => el.tagName === 'H3');
    expect(sectionHeader).toBeDefined();
  });
});

describe('AccountPanel — panel migration', () => {
  beforeEach(() => {
    mockUseHasPermission.mockImplementation((): boolean => true);
  });

  it('renders RecordActionBar section', () => {
    render(<AccountPanel open={true} onOpenChange={() => {}} account={MOCK_ACCOUNT} />);
    clickDetailsTab();

    // AccountPanel has RecordActionBar with no email/phone (org-level)
    // The "Actions" section should be present
    expect(screen.getByText('Actions')).toBeDefined();
    // The overflow menu trigger (More button) should exist
    expect(screen.getByTitle('Send message')).toBeDefined();
  });

  it('renders CustomFieldsSection', () => {
    render(<AccountPanel open={true} onOpenChange={() => {}} account={MOCK_ACCOUNT} />);
    clickDetailsTab();

    const customFieldsElements = screen.getAllByText('Custom Fields');
    expect(customFieldsElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders FilesSection', () => {
    render(<AccountPanel open={true} onOpenChange={() => {}} account={MOCK_ACCOUNT} />);
    clickDetailsTab();

    const filesElements = screen.getAllByText('Files');
    expect(filesElements.length).toBeGreaterThanOrEqual(1);
    // Verify at least one is a section header (h3)
    const sectionHeader = filesElements.find((el) => el.tagName === 'H3');
    expect(sectionHeader).toBeDefined();
  });
});
