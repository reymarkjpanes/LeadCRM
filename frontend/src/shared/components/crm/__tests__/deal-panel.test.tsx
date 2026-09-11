/**
 * Unit tests for DealPanel — enriched deal detail panel.
 *
 * Validates:
 * - DealPanel renders all enriched sections when deal is provided
 * - PipelineProgressBar section is visible
 * - RecordActionBar renders with correct buttons
 * - Tasks section shows deal tasks
 * - Custom Fields section is present
 * - Files section is present
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockMoveDealStage = vi.fn().mockResolvedValue(undefined);
const mockDeleteDeal = vi.fn().mockResolvedValue(undefined);
const mockAddTask = vi.fn().mockResolvedValue(undefined);
const mockUpdateDeal = vi.fn().mockResolvedValue(undefined);
const mockUpdateTask = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/DataContext', () => ({
  useData: () => ({
    pipelines: [
      {
        id: 'pipe-1',
        name: 'Sales Pipeline',
        stages: [
          { id: 'stg-1', name: 'Prospect', order: 1, isWon: false, isLost: false },
          { id: 'stg-2', name: 'Proposal', order: 2, isWon: false, isLost: false },
          { id: 'stg-3', name: 'Negotiation', order: 3, isWon: false, isLost: false },
          { id: 'stg-4', name: 'Won', order: 4, isWon: true, isLost: false },
        ],
      },
    ],
    moveDealStage: mockMoveDealStage,
    deleteDeal: mockDeleteDeal,
    addTask: mockAddTask,
    updateDeal: mockUpdateDeal,
    updateTask: mockUpdateTask,
    tasks: [
      {
        id: 'task-1',
        title: 'Follow up with client',
        dealId: 'deal-1',
        status: 'pending',
        priority: 'High',
        dueDate: '2025-02-15T00:00:00.000Z',
      },
      {
        id: 'task-2',
        title: 'Prepare proposal',
        dealId: 'deal-1',
        status: 'completed',
        priority: 'Medium',
        dueDate: '2025-02-10T00:00:00.000Z',
      },
      {
        id: 'task-unrelated',
        title: 'Unrelated task',
        dealId: 'deal-99',
        status: 'pending',
        priority: 'Low',
        dueDate: null,
      },
    ],
    contacts: [
      { id: 'contact-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '+639001234' },
    ],
    organizations: [
      { id: 'org-1', name: 'Acme Corp', industry: 'Technology', city: 'Manila' },
    ],
    users: [
      { id: 'u-1', firstName: 'Admin', lastName: 'User', email: 'admin@test.com' },
    ],
    roles: [],
    deals: [],
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

// Mock deals-actions.api dynamic import
vi.mock('@/shared/services/deals-actions.api', () => ({
  duplicateDeal: vi.fn().mockResolvedValue(undefined),
  restoreDeal: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import Component Under Test ──────────────────────────────────────────────

import { DealPanel } from '../RecordPanelWrappers';
import type { Deal } from '@/store/types';

// ─── Test Data ────────────────────────────────────────────────────────────────

const MOCK_DEAL: Deal = {
  id: 'deal-1',
  title: 'Enterprise Security Package',
  value: 250000,
  currency: 'PHP',
  priority: 'High',
  stageId: 'stg-2',
  pipelineId: 'pipe-1',
  description: 'Large enterprise deal for security services',
  expectedCloseDate: '2025-03-15T00:00:00.000Z',
  contactIds: ['contact-1'],
  organizationId: 'org-1',
  companyName: 'Acme Corp',
  createdAt: '2025-01-10T00:00:00.000Z',
  isArchived: false,
} as unknown as Deal;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Renders DealPanel and clicks the "Details" tab to show sections */
function renderDealPanelOnDetailsTab(deal: Deal | null = MOCK_DEAL) {
  const result = render(
    <DealPanel open={true} onOpenChange={() => {}} deal={deal} />
  );

  if (deal) {
    // The RecordPanel defaults to the "Activity" tab; click "Details" to see sections
    const detailsTab = screen.getByRole('tab', { name: /details/i });
    fireEvent.click(detailsTab);
  }

  return result;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DealPanel', () => {
  beforeEach(() => {
    mockUseHasPermission.mockImplementation((): boolean => true);
    mockMoveDealStage.mockClear();
    mockDeleteDeal.mockClear();
  });

  it('renders with all enriched sections when deal is provided', () => {
    renderDealPanelOnDetailsTab();

    // Deal title in the panel header
    expect(screen.getByText('Enterprise Security Package')).toBeDefined();

    // Section headers should be present (rendered as uppercase text in SectionCard)
    expect(screen.getByText('Pipeline')).toBeDefined();
    expect(screen.getByText('Actions')).toBeDefined();
    expect(screen.getByText('About Deal')).toBeDefined();
    expect(screen.getByText('Associated Contacts')).toBeDefined();
    expect(screen.getByText('Company / Organization')).toBeDefined();
    expect(screen.getByText('Tasks')).toBeDefined();
    // "Custom Fields" and "Files" appear in both tab triggers and section headers
    expect(screen.getAllByText('Custom Fields').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Files').length).toBeGreaterThanOrEqual(1);
  });

  it('PipelineProgressBar section is visible with stage dots', () => {
    renderDealPanelOnDetailsTab();

    // The PipelineProgressBar renders stage buttons with aria-labels.
    // Current stage is stg-2 "Proposal", check for the "(current)" label
    expect(screen.getByLabelText('Proposal (current)')).toBeDefined();

    // All stage buttons should be rendered (4 stages in the pipeline)
    const stageButtons = screen.getAllByRole('button').filter(
      (btn) => btn.getAttribute('aria-label')?.includes('Prospect') ||
               btn.getAttribute('aria-label')?.includes('Proposal') ||
               btn.getAttribute('aria-label')?.includes('Negotiation') ||
               btn.getAttribute('aria-label')?.includes('Won')
    );
    expect(stageButtons.length).toBe(4);
  });

  it('RecordActionBar renders with email and phone buttons', () => {
    renderDealPanelOnDetailsTab();

    // RecordActionBar uses the primary contact's email/phone
    expect(screen.getByTitle('Email alice@example.com')).toBeDefined();
    expect(screen.getByTitle('Call +639001234')).toBeDefined();
    expect(screen.getByTitle('Send message')).toBeDefined();
  });

  it('Tasks section shows deal tasks', () => {
    renderDealPanelOnDetailsTab();

    // Should show tasks linked to deal-1
    expect(screen.getByText('Follow up with client')).toBeDefined();
    expect(screen.getByText('Prepare proposal')).toBeDefined();

    // Should NOT show the unrelated task
    expect(screen.queryByText('Unrelated task')).toBeNull();
  });

  it('Custom Fields section is present', () => {
    renderDealPanelOnDetailsTab();

    // Custom Fields section header should be rendered (may also appear in tab/badge)
    const customFieldsElements = screen.getAllByText('Custom Fields');
    expect(customFieldsElements.length).toBeGreaterThanOrEqual(1);
    // Verify at least one is an h3 section header
    const sectionHeader = customFieldsElements.find((el) => el.tagName === 'H3');
    expect(sectionHeader).toBeDefined();
  });

  it('Files section is present', () => {
    renderDealPanelOnDetailsTab();

    // Files section header should be rendered (may also appear in tab trigger)
    const filesElements = screen.getAllByText('Files');
    expect(filesElements.length).toBeGreaterThanOrEqual(1);
    // Verify at least one is an h3 section header
    const sectionHeader = filesElements.find((el) => el.tagName === 'H3');
    expect(sectionHeader).toBeDefined();
  });

  it('returns null when deal is null', () => {
    const { container } = render(
      <DealPanel
        open={true}
        onOpenChange={() => {}}
        deal={null}
      />
    );

    expect(container.innerHTML).toBe('');
  });
});
