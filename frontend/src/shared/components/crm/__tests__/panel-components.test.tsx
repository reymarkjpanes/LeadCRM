import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock useData from DataContext
vi.mock('@/store/DataContext', () => ({
  useData: () => ({
    pipelines: [
      {
        id: 'pipe-1',
        name: 'Sales Pipeline',
        stages: [
          { id: 'stg-1', name: 'Prospect', order: 1 },
          { id: 'stg-2', name: 'Proposal', order: 2 },
          { id: 'stg-3', name: 'Negotiation', order: 3 },
        ],
      },
    ],
    users: [
      { id: 'u-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com' },
      { id: 'u-2', firstName: 'Bob', lastName: 'Jones', email: 'bob@test.com' },
    ],
    roles: [],
  }),
}));

// Mock useAuth from AuthContext
vi.mock('@/store/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', role: 'Client Admin', email: 'admin@test.com' },
  }),
}));

// Mock useHasPermission — default returns true (has permission)
const mockUseHasPermission = vi.fn((_permission: string): boolean => true);
vi.mock('@/shared/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockUseHasPermission(permission),
  usePermissions: () => ['*'],
  useCanAny: () => true,
  PERMISSION_BRIDGE: {},
}));

// ─── Import Components Under Test ─────────────────────────────────────────────

import { RecordActionBar } from '../record-action-bar';
import { InlineTaskForm } from '../inline-task-form';
import { InlineDealForm } from '../inline-deal-form';
import { PipelineProgressBar } from '../pipeline-progress-bar';

// ─── RecordActionBar Tests ────────────────────────────────────────────────────

describe('RecordActionBar', () => {
  beforeEach(() => {
    mockUseHasPermission.mockImplementation((_permission: string): boolean => true);
  });

  it('renders email, call, message, and log activity buttons', () => {
    render(
      <RecordActionBar
        email="test@example.com"
        phone="+1234567890"
        onLogActivity={() => {}}
      />
    );

    expect(screen.getByTitle('Email test@example.com')).toBeDefined();
    expect(screen.getByTitle('Call +1234567890')).toBeDefined();
    expect(screen.getByTitle('Send message')).toBeDefined();
    expect(screen.getByTitle('Log activity')).toBeDefined();
  });

  it('disables email button when email is null', () => {
    render(
      <RecordActionBar email={null} phone="+1234567890" />
    );

    const emailButton = screen.getByTitle('No email available');
    expect(emailButton).toBeDefined();
    expect(emailButton.closest('button')?.disabled).toBe(true);
  });

  it('disables call button when phone is null', () => {
    render(
      <RecordActionBar email="test@example.com" phone={null} />
    );

    const callButton = screen.getByTitle('No phone available');
    expect(callButton).toBeDefined();
    expect(callButton.closest('button')?.disabled).toBe(true);
  });

  it('does not render log activity button when onLogActivity is not provided', () => {
    render(
      <RecordActionBar email="test@example.com" phone="+1234567890" />
    );

    expect(screen.queryByTitle('Log activity')).toBeNull();
  });
});

// ─── InlineTaskForm Tests ─────────────────────────────────────────────────────

describe('InlineTaskForm', () => {
  const mockOnSubmit = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    mockOnSubmit.mockClear();
  });

  it('renders Task and Call tab buttons', () => {
    render(
      <InlineTaskForm onSubmit={mockOnSubmit} recordName="John Doe" />
    );

    expect(screen.getByText('Task')).toBeDefined();
    expect(screen.getByText('Call')).toBeDefined();
  });

  it('shows title required error when submitting with empty title', async () => {
    render(
      <InlineTaskForm onSubmit={mockOnSubmit} recordName="John Doe" />
    );

    const submitButton = screen.getByText('Save Task');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeDefined();
    });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('renders due date and assignee fields', () => {
    render(
      <InlineTaskForm onSubmit={mockOnSubmit} recordName="John Doe" />
    );

    // Date input and assignee select should exist
    const dateInput = document.querySelector('input[type="date"]');
    expect(dateInput).toBeDefined();

    // Assignee select with user options
    expect(screen.getByText('Assignee (Default)')).toBeDefined();
  });
});

// ─── InlineDealForm Tests ─────────────────────────────────────────────────────

describe('InlineDealForm', () => {
  const mockOnSubmit = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    mockOnSubmit.mockClear();
  });

  it('renders pipeline and stage select fields', () => {
    render(
      <InlineDealForm onSubmit={mockOnSubmit} />
    );

    expect(screen.getByText('Pipeline *')).toBeDefined();
    expect(screen.getByText('Stage *')).toBeDefined();
    expect(screen.getByText('Select pipeline')).toBeDefined();
  });

  it('renders title field with required label', () => {
    render(
      <InlineDealForm onSubmit={mockOnSubmit} />
    );

    expect(screen.getByText('Title *')).toBeDefined();
    expect(screen.getByPlaceholderText('Deal title')).toBeDefined();
  });

  it('shows title required error on submit with empty title', async () => {
    render(
      <InlineDealForm onSubmit={mockOnSubmit} />
    );

    const submitButton = screen.getByText('Create Deal');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeDefined();
    });

    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('renders value, expected close, confidence and description fields', () => {
    render(
      <InlineDealForm onSubmit={mockOnSubmit} />
    );

    expect(screen.getByText('Value')).toBeDefined();
    expect(screen.getByText('Expected Close')).toBeDefined();
    expect(screen.getByText('Confidence (%)')).toBeDefined();
    expect(screen.getByText('Description')).toBeDefined();
  });
});

// ─── PipelineProgressBar Tests ────────────────────────────────────────────────

describe('PipelineProgressBar', () => {
  const stages = [
    { id: 'stg-1', name: 'Prospect', order: 1 },
    { id: 'stg-2', name: 'Proposal', order: 2 },
    { id: 'stg-3', name: 'Negotiation', order: 3 },
    { id: 'stg-4', name: 'Closing', order: 4 },
  ];

  it('renders the correct number of stage dot buttons', () => {
    render(
      <PipelineProgressBar
        stages={stages}
        currentStageId="stg-2"
      />
    );

    // Each stage renders as a button element
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(4);
  });

  it('highlights current stage with aria-label containing "(current)"', () => {
    render(
      <PipelineProgressBar
        stages={stages}
        currentStageId="stg-3"
      />
    );

    const currentStageButton = screen.getByLabelText('Negotiation (current)');
    expect(currentStageButton).toBeDefined();
  });

  it('applies ring styling to current stage dot', () => {
    render(
      <PipelineProgressBar
        stages={stages}
        currentStageId="stg-2"
      />
    );

    const currentButton = screen.getByLabelText('Proposal (current)');
    expect(currentButton.className).toContain('ring-2');
  });

  it('disables stage buttons when canChangeStage is false', () => {
    render(
      <PipelineProgressBar
        stages={stages}
        currentStageId="stg-2"
        canChangeStage={false}
      />
    );

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('shows compact text for narrow panels', () => {
    render(
      <PipelineProgressBar
        stages={stages}
        currentStageId="stg-2"
      />
    );

    // The compact view text should be present in the DOM (hidden via CSS on wider panels)
    expect(screen.getByText('Stage 2 of 4')).toBeDefined();
  });
});
