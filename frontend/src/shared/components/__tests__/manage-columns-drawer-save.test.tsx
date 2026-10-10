/**
 * Unit tests for ManageColumnsDrawer save with retry and unsaved-changes guard.
 *
 * Validates Requirements:
 * - 5.2: Save persists via onSave (PUT /api/v1/preferences/columns/:module)
 * - 5.3: Inline error with Retry button, 3 attempts max, then "close and try again"
 * - 5.7: Confirmation dialog on close with unsaved changes
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ManageColumnsDrawer } from '../manage-columns-drawer';
import type { ColumnDefinition, ColumnConfigItem } from '@leadcrm/shared';

// Mock @dnd-kit modules used internally by ManageColumnsDrawer
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  verticalListSortingStrategy: vi.fn(),
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => null } },
}));

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const REGISTRY: ColumnDefinition[] = [
  { id: 'name', label: 'Name', required: true, defaultVisible: true, defaultOrder: 0, group: 'General', priority: 'required' },
  { id: 'email', label: 'Email', required: false, defaultVisible: true, defaultOrder: 1, group: 'General', priority: 'high' },
  { id: 'phone', label: 'Phone', required: false, defaultVisible: true, defaultOrder: 2, group: 'Contact', priority: 'medium' },
];

const EFFECTIVE_COLUMNS: ColumnConfigItem[] = [
  { id: 'name', visible: true, order: 0 },
  { id: 'email', visible: true, order: 1 },
  { id: 'phone', visible: true, order: 2 },
];

function renderDrawer(overrides: Partial<React.ComponentProps<typeof ManageColumnsDrawer>> = {}) {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    module: 'leads',
    registry: REGISTRY,
    effectiveColumns: EFFECTIVE_COLUMNS,
    onSave: vi.fn().mockResolvedValue(undefined),
    onReset: vi.fn().mockResolvedValue(undefined),
  };

  const props = { ...defaultProps, ...overrides };
  const result = render(React.createElement(ManageColumnsDrawer, props));
  return { ...result, props };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ManageColumnsDrawer — save, retry, and unsaved-changes guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Requirement 5.2: Save persists via onSave', () => {
    it('calls onSave with updated column config when Save is clicked', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      renderDrawer({ onSave });

      // Toggle email visibility to create a change
      const emailToggle = screen.getByLabelText('Toggle Email visibility');
      await act(async () => { fireEvent.click(emailToggle); });

      // Click Save
      const saveButton = screen.getByText('Save');
      await act(async () => { fireEvent.click(saveButton); });

      expect(onSave).toHaveBeenCalledTimes(1);
      const savedConfig = onSave.mock.calls[0][0] as ColumnConfigItem[];
      const emailCol = savedConfig.find((c) => c.id === 'email');
      expect(emailCol?.visible).toBe(false);
    });

    it('Save button is disabled when there are no changes', () => {
      renderDrawer();
      const saveButton = screen.getByText('Save');
      expect(saveButton.hasAttribute('disabled')).toBe(true);
    });

    it('shows "Saving..." during save operation', async () => {
      let resolveSave: () => void;
      const onSave = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
      renderDrawer({ onSave });

      // Create a change
      const emailToggle = screen.getByLabelText('Toggle Email visibility');
      await act(async () => { fireEvent.click(emailToggle); });

      // Click Save (don't resolve yet)
      await act(async () => { fireEvent.click(screen.getByText('Save')); });

      expect(screen.getByText('Saving...')).toBeTruthy();

      // Cleanup: resolve the save
      await act(async () => { resolveSave!(); });
    });

    it('shows "Saved" after successful save', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      renderDrawer({ onSave });

      // Create a change
      const emailToggle = screen.getByLabelText('Toggle Email visibility');
      await act(async () => { fireEvent.click(emailToggle); });

      // Click Save
      await act(async () => { fireEvent.click(screen.getByText('Save')); });

      await waitFor(() => {
        expect(screen.getByText('Saved')).toBeTruthy();
      });
    });
  });

  describe('Requirement 5.3: Inline error with Retry, max 3 attempts', () => {
    it('shows inline error with Retry button on save failure', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Network error'));
      renderDrawer({ onSave });

      // Create a change
      const emailToggle = screen.getByLabelText('Toggle Email visibility');
      await act(async () => { fireEvent.click(emailToggle); });

      // Click Save — will fail
      await act(async () => { fireEvent.click(screen.getByText('Save')); });

      await waitFor(() => {
        expect(screen.getByText('Unable to save')).toBeTruthy();
        expect(screen.getByText('Retry')).toBeTruthy();
      });
    });

    it('allows up to 3 retry attempts then shows close message', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Network error'));
      renderDrawer({ onSave });

      // Create a change
      const emailToggle = screen.getByLabelText('Toggle Email visibility');
      await act(async () => { fireEvent.click(emailToggle); });

      // First save attempt (fails) — retryCount becomes 1
      await act(async () => { fireEvent.click(screen.getByText('Save')); });
      await waitFor(() => { expect(screen.getByText('Retry')).toBeTruthy(); });

      // Retry 1 (fails) — retryCount becomes 2
      await act(async () => { fireEvent.click(screen.getByText('Retry')); });
      await waitFor(() => { expect(screen.getByText('Retry')).toBeTruthy(); });

      // Retry 2 (fails) — retryCount becomes 3
      await act(async () => { fireEvent.click(screen.getByText('Retry')); });

      // After 3 consecutive failures: show "close and try again" message, no Retry button
      await waitFor(() => {
        expect(screen.getByText(/close and try again/i)).toBeTruthy();
        expect(screen.queryByText('Retry')).toBeNull();
      });

      expect(onSave).toHaveBeenCalledTimes(3);
    });

    it('resets retry count on successful save after failure', async () => {
      const onSave = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(undefined);
      renderDrawer({ onSave });

      // Create a change
      const emailToggle = screen.getByLabelText('Toggle Email visibility');
      await act(async () => { fireEvent.click(emailToggle); });

      // First save attempt (fails)
      await act(async () => { fireEvent.click(screen.getByText('Save')); });
      await waitFor(() => { expect(screen.getByText('Retry')).toBeTruthy(); });

      // Retry succeeds
      await act(async () => { fireEvent.click(screen.getByText('Retry')); });

      await waitFor(() => {
        expect(screen.getByText('Saved')).toBeTruthy();
      });

      expect(screen.queryByText('Unable to save')).toBeNull();
    });
  });

  describe('Requirement 5.7: Confirmation dialog on close with unsaved changes', () => {
    it('Escape dismisses the discard confirmation without also closing its drawer', async () => {
      const onClose = vi.fn();
      renderDrawer({ onClose });
      await act(async () => { fireEvent.click(screen.getByLabelText('Toggle Email visibility')); });
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
      expect(screen.getByText('Discard changes?')).toBeTruthy();
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
      expect(screen.queryByText('Discard changes?')).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Manage Columns - leads' })).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not close or open a discard dialog while a save is pending', async () => {
      let finishSave: () => void;
      const onSave = vi.fn(() => new Promise<void>(resolve => { finishSave = resolve; }));
      const onClose = vi.fn();
      renderDrawer({ onSave, onClose });
      await act(async () => { fireEvent.click(screen.getByLabelText('Toggle Email visibility')); });
      await act(async () => { fireEvent.click(screen.getByText('Save')); });
      expect((screen.getByLabelText('Close drawer') as HTMLButtonElement).disabled).toBe(true);
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
      expect(screen.queryByText('Discard changes?')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => finishSave());
      expect(screen.getByText('Saved')).toBeTruthy();
    });

    it('shows confirmation dialog when closing with unsaved changes', async () => {
      const onClose = vi.fn();
      renderDrawer({ onClose });

      // Create a change
      const emailToggle = screen.getByLabelText('Toggle Email visibility');
      await act(async () => { fireEvent.click(emailToggle); });

      // Click close button
      const closeButton = screen.getByLabelText('Close drawer');
      await act(async () => { fireEvent.click(closeButton); });

      // Confirmation dialog should appear
      expect(screen.getByText('Discard changes?')).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes drawer when user confirms discard', async () => {
      const onClose = vi.fn();
      renderDrawer({ onClose });

      // Create a change
      const emailToggle = screen.getByLabelText('Toggle Email visibility');
      await act(async () => { fireEvent.click(emailToggle); });

      // Click close button
      const closeButton = screen.getByLabelText('Close drawer');
      await act(async () => { fireEvent.click(closeButton); });

      // Click Discard in the dialog
      const discardButton = screen.getByText('Discard');
      await act(async () => { fireEvent.click(discardButton); });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps drawer open when user cancels the discard dialog', async () => {
      const onClose = vi.fn();
      renderDrawer({ onClose });

      // Create a change
      const emailToggle = screen.getByLabelText('Toggle Email visibility');
      await act(async () => { fireEvent.click(emailToggle); });

      // Click close button
      const closeButton = screen.getByLabelText('Close drawer');
      await act(async () => { fireEvent.click(closeButton); });

      // Click "Keep editing" in the dialog
      const keepEditingButton = screen.getByText('Keep editing');
      await act(async () => { fireEvent.click(keepEditingButton); });

      expect(onClose).not.toHaveBeenCalled();
      // Dialog should be dismissed
      expect(screen.queryByText('Discard changes?')).toBeNull();
    });

    it('closes directly without dialog when no unsaved changes', async () => {
      const onClose = vi.fn();
      renderDrawer({ onClose });

      // Click close button without making changes
      const closeButton = screen.getByLabelText('Close drawer');
      await act(async () => { fireEvent.click(closeButton); });

      // No dialog, just close
      expect(screen.queryByText('Discard changes?')).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
