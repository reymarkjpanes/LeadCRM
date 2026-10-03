import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ get: vi.fn(), reorder: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), dragEnd: null as any }));
vi.mock('@/shared/hooks/use-permissions', () => ({ useHasPermission: () => true }));
vi.mock('@/shared/services/pipelines.api', () => ({ pipelinesApi: { get: mocks.get, reorderStages: mocks.reorder, createStage: mocks.create, updateStage: mocks.update, deleteStage: mocks.remove } }));
vi.mock('@dnd-kit/core', async importOriginal => ({ ...await importOriginal<typeof import('@dnd-kit/core')>(), DndContext: ({ children, onDragEnd }: any) => { mocks.dragEnd = onDragEnd; return <>{children}</>; } }));
import { PipelineStagesDialog } from './pipeline-stages-dialog';

let stages: any[];
beforeEach(() => {
  vi.clearAllMocks();
  stages = ['Lead', 'Contacted', 'Qualified', 'Won', 'Lost'].map((name, index) => ({ id: `s${index}`, name, order: index + 1, isDefault: index === 0, isWon: index === 3, isLost: index === 4 }));
  mocks.get.mockImplementation(async () => ({ data: { stages } }));
  mocks.reorder.mockImplementation(async (_pipeline, ids: string[]) => { stages = ids.map((id, index) => ({ ...stages.find(stage => stage.id === id), order: index + 1 })); return { data: { stages } }; });
});
afterEach(cleanup);
const open = async () => { render(<PipelineStagesDialog pipelineId="p" onClose={vi.fn()} onChanged={async () => {}} />); await screen.findByDisplayValue('Lead'); };

it('persists every original ID once and keeps unsaved names attached to the same stage after reorder', async () => {
  await open();
  fireEvent.change(screen.getByDisplayValue('Contacted'), { target: { value: 'Draft contact name' } });
  expect(mocks.reorder).not.toHaveBeenCalled();
  await act(async () => mocks.dragEnd({ active: { id: 's1' }, over: { id: 's2' } }));
  expect(mocks.reorder).toHaveBeenCalledExactlyOnceWith('p', ['s0', 's2', 's1', 's3', 's4']);
  expect((screen.getByLabelText('Stage 3') as HTMLInputElement).value).toBe('Draft contact name');
  expect(mocks.update).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Move .* up/ })).toBeNull();
  expect(screen.getAllByRole('button', { name: /Drag to reorder stage/ })).toHaveLength(5);
  expect((screen.getByRole('button', { name: 'Remove Lead' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Remove Won' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Remove Lost' }) as HTMLButtonElement).disabled).toBe(true);
});

it('restores the original order on rejection without losing edited text', async () => {
  mocks.reorder.mockRejectedValueOnce(new Error('Order rejected'));
  await open();
  fireEvent.change(screen.getByDisplayValue('Contacted'), { target: { value: 'Still editing' } });
  await act(async () => mocks.dragEnd({ active: { id: 's1' }, over: { id: 's2' } }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Order rejected');
  expect((screen.getByLabelText('Stage 2') as HTMLInputElement).value).toBe('Still editing');
});

it('guards creation while pending, clears only after success and preserves other drafts', async () => {
  let resolve!: () => void;
  mocks.create.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  await open();
  fireEvent.change(screen.getByDisplayValue('Qualified'), { target: { value: 'Draft qualified' } });
  const input = screen.getByLabelText('New stage') as HTMLInputElement;
  expect((screen.getByRole('button', { name: 'Add stage' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: 'Negotiation' } });
  fireEvent.submit(input.closest('form')!); fireEvent.submit(input.closest('form')!);
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ pipelineId: 'p', name: 'Negotiation', order: 6 });
  expect(input.value).toBe('Negotiation');
  await act(async () => resolve());
  await waitFor(() => expect(input.value).toBe(''));
  expect(screen.getByDisplayValue('Draft qualified')).toBeTruthy();
});

it('trims and persists a stage rename through the existing service', async () => {
  mocks.update.mockImplementation(async (id, update) => { stages = stages.map(stage => stage.id === id ? { ...stage, ...update } : stage); });
  await open();
  fireEvent.change(screen.getByDisplayValue('Contacted'), { target: { value: '  Discovery  ' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save name' })[1]);
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('s1', { name: 'Discovery' }));
  await waitFor(() => expect((screen.getAllByRole('button', { name: 'Save name' })[1] as HTMLButtonElement).disabled).toBe(true));
});

it('requires removal confirmation and surfaces server reference constraints', async () => {
  mocks.remove.mockRejectedValue(new Error('Stage is referenced by existing Deals.'));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Contacted' }));
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Contacted' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove stage' }));
  expect((await screen.findByRole('alert')).textContent).toContain('referenced');
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('s1');
});
