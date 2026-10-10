import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_TRIGGERS,
  getAvailableActions,
  WorkflowDraftSchema,
  type WorkflowDraft,
} from '@leadcrm/shared';
import {
  canPlace,
  editorDocument,
  insertAction,
  moveAction,
  toDraft,
  editorIssues,
} from './workflow-editor';
const actions = getAvailableActions(),
  options = { senders: [{ id: "sender", name: "Sender" }], users: [], pipelines: [], templates: [], campaigns: [] };
const draft: WorkflowDraft = {
  name: 'Sequence',
  trigger: 'lead.created',
  isActive: false,
  actions: [
    { type: 'create_task', config: { title: 'A' } },
    { type: 'create_task', config: { title: 'B' } },
    { type: 'create_task', config: { title: 'C' } },
  ],
};
describe('canonical workflow editing operations', () => {
  it('moves at original insertion boundaries without losing identity or configuration', () => {
    const original = editorDocument(draft),
      id = original.actionIds[0];
    const moved = moveAction(original, id, 3);
    expect(moved.draft.actions.map((action) => action.config.title)).toEqual([
      'B',
      'C',
      'A',
    ]);
    expect(moved.actionIds[2]).toBe(id);
    expect(original.draft.actions[0].config.title).toBe('A');
    expect(moveAction(moved, id, 0).draft).toEqual(original.draft);
    expect(moveAction(original, id, 1)).toBe(original);
  });
  it('allows related-Deal moves and rejects invalid positions and conditions after actions', () => {
    const document = editorDocument(draft);
    expect(
      canPlace(
        { kind: 'action', type: 'move_deal_stage' },
        { kind: 'action', index: 0 },
        document,
        WORKFLOW_TRIGGERS,
        actions,
      ),
    ).toBe(true);
    expect(
      canPlace(
        { kind: 'trigger', type: 'lead.created' },
        { kind: 'action', index: 0 },
        document,
        WORKFLOW_TRIGGERS,
        actions,
      ),
    ).toBe(false);
    expect(
      canPlace(
        { kind: 'condition' },
        { kind: 'action', index: 2 },
        document,
        WORKFLOW_TRIGGERS,
        actions,
      ),
    ).toBe(false);
    expect(
      canPlace(
        { kind: 'action', type: 'create_task' },
        { kind: 'action', index: 4 },
        document,
        WORKFLOW_TRIGGERS,
        actions,
      ),
    ).toBe(false);
    expect(
      canPlace(
        { kind: 'action', type: 'create_task' },
        { kind: 'action', index: 3 },
        document,
        WORKFLOW_TRIGGERS,
        actions,
      ),
    ).toBe(true);
  });
  it('respects the 20-action limit for insertion while allowing movement', () => {
    const document = editorDocument({
      ...draft,
      actions: Array.from({ length: 20 }, () => draft.actions[0]),
    });
    expect(
      canPlace(
        { kind: 'action', type: 'create_task' },
        { kind: 'action', index: 0 },
        document,
        WORKFLOW_TRIGGERS,
        actions,
      ),
    ).toBe(false);
    expect(
      canPlace(
        { kind: 'move', id: document.actionIds[0] },
        { kind: 'action', index: 20 },
        document,
        WORKFLOW_TRIGGERS,
        actions,
      ),
    ).toBe(true);
    expect(insertAction(document, draft.actions[0], 0, 'extra')).toBe(document);
  });
  it('serializes only the existing contract and keeps disabled state across round trips', () => {
    const document = insertAction(
      editorDocument(draft),
      { type: 'send_email', enabled: false, config: {} },
      1,
      'editor-only',
    );
    const serialized = WorkflowDraftSchema.parse(toDraft(document.draft));
    expect(JSON.stringify(serialized)).not.toContain('editor-only');
    expect(serialized.actions[1].enabled).toBe(false);
    expect(editorIssues(document, WORKFLOW_TRIGGERS, actions, options)).toEqual(
      [],
    );
    expect(
      WorkflowDraftSchema.safeParse({
        ...serialized,
        actions: [{ ...serialized.actions[0], enabled: 'false' }],
      }).success,
    ).toBe(false);
  });
});
