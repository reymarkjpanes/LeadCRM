/**
 * Unit tests for the hidden columns indicator badge in DataGrid.
 *
 * Requirement 7.7: WHEN one or more non-required columns are automatically hidden
 * due to insufficient container width, THE DataGrid SHALL provide a visible indicator
 * showing the count of hidden columns.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DataGrid } from '../data-grid';
import type { DataGridColumnDef } from '../types';

// Mock ResizeObserver
global.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// ─── Test Data ───────────────────────────────────────────────────────────────

interface TestRow {
  id: string;
  name: string;
}

const testColumns: DataGridColumnDef<TestRow>[] = [
  {
    id: 'name',
    header: 'Name',
    accessor: (row) => row.name,
    sortable: true,
    resizable: true,
  },
];

const testData: TestRow[] = [{ id: '1', name: 'Test Record' }];

// Helper to create DataGrid element without JSX
function createDataGrid(props: Record<string, unknown>) {
  return React.createElement(DataGrid, {
    columns: testColumns,
    data: testData,
    getRowId: (row: TestRow) => row.id,
    ...props,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Hidden Columns Indicator Badge', () => {
  it('does not render badge when hiddenColumnsCount is undefined', () => {
    render(createDataGrid({ onSettingsClick: () => {} }));
    expect(screen.queryByLabelText(/column.*hidden/i)).toBeNull();
  });

  it('does not render badge when hiddenColumnsCount is 0', () => {
    render(createDataGrid({ onSettingsClick: () => {}, hiddenColumnsCount: 0 }));
    expect(screen.queryByLabelText(/column.*hidden/i)).toBeNull();
  });

  it('renders badge with count when hiddenColumnsCount > 0', () => {
    render(createDataGrid({ onSettingsClick: () => {}, hiddenColumnsCount: 3 }));
    const badge = screen.getByLabelText('3 columns hidden');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('3');
  });

  it('renders singular label when hiddenColumnsCount is 1', () => {
    render(createDataGrid({ onSettingsClick: () => {}, hiddenColumnsCount: 1 }));
    const badge = screen.getByLabelText('1 column hidden');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('1');
  });

  it('renders badge even without onSettingsClick when hiddenColumnsCount > 0', () => {
    render(createDataGrid({ hiddenColumnsCount: 2 }));
    const badge = screen.getByLabelText('2 columns hidden');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('2');
  });

  it('renders both badge and settings button when both are present', () => {
    const onSettingsClick = vi.fn();
    render(createDataGrid({ onSettingsClick, hiddenColumnsCount: 5 }));

    // Badge should be present
    const badge = screen.getByLabelText('5 columns hidden');
    expect(badge).toBeTruthy();

    // Settings button should also be present
    const settingsButton = screen.getByLabelText('Table settings');
    expect(settingsButton).toBeTruthy();
  });

  it('includes EyeOff icon in the badge', () => {
    render(createDataGrid({ hiddenColumnsCount: 4 }));
    const badge = screen.getByLabelText('4 columns hidden');
    // The badge should contain an SVG (EyeOff icon)
    const icon = badge.querySelector('svg');
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });
});
