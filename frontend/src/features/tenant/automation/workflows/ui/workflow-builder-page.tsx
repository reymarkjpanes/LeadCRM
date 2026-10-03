'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type {
  WorkflowDraft,
  WorkflowOptions,
  TriggerDefinition,
  ActionDefinition,
  Workflow,
} from '@leadcrm/shared';
import { useAuth } from '@/store/AuthContext';
import { useData } from '@/store/DataContext';
import {
  getWorkflowMetadata,
  workflowsApi,
} from '@/shared/services/workflows.api';
import { Button } from '@/shared/components/ui/button';
import WorkflowBuilder from './visual-workflow-builder';
import { WORKFLOW_RECIPES, prepareWorkflowRecipe } from '../services/workflow-recipes';
export default function WorkflowBuilderPage() {
  const router = useRouter(),
    params = useParams<{ id?: string }>(),
    query = useSearchParams();
  const { tenant, user, userCan } = useAuth();
  const { addWorkflow, updateWorkflow } = useData();
  const [loaded, setLoaded] = useState<{
    initial: WorkflowDraft;
    options: WorkflowOptions;
    triggers: TriggerDefinition[];
    actions: ActionDefinition[];
    initialStatus?: Workflow['status'];
  } | null>(null);
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const canView = userCan('workflows', 'canView'),
    canEdit = userCan('workflows', 'canEdit'),
    canCreate = userCan('workflows', 'canCreate');
  const id = params.id,
    recipe = query.get('template');
  const createdId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!tenant?.id || !canView || (!id && !canCreate)) return;
    let cancelled = false;
    setLoaded(null);
    setError('');
    createdId.current = undefined;
    Promise.all([
      getWorkflowMetadata(
        `${tenant.id}:${user?.id}`,
      ),
      workflowsApi.options(),
      id ? workflowsApi.get(id) : Promise.resolve(null),
    ])
      .then(([metadata, options, response]) => {
        if (cancelled) return;
        const saved = response?.data;
        if (!saved && recipe !== null && (!/^(0|[1-9]\d*)$/.test(recipe) || !WORKFLOW_RECIPES[Number(recipe)])) {
          throw new Error('This workflow template is unavailable. Return to workflows and choose another template.');
        }
        const selected =
          recipe === null ? undefined : WORKFLOW_RECIPES[Number(recipe)];
        const initial: WorkflowDraft = saved
          ? {
              name: saved.name,
              description: saved.description,
              trigger: saved.trigger,
              conditions: saved.conditions,
              actions: saved.actions,
              isActive: saved.isActive,
            }
          : selected
            ? prepareWorkflowRecipe(selected, options.data)
            : {
                name: '',
                description: '',
                trigger: '',
                isActive: false,
                actions: [],
              };
        setLoaded({
          initial,
          initialStatus: saved?.status,
          options: options.data,
          ...metadata,
        });
      })
      .catch((failure) => {
        if (!cancelled)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Unable to load workflow.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [
    tenant?.id,
    user?.id,
    id,
    recipe,
    canView,
    canCreate,
    retry,
  ]);
  if (!canView || (!id && !canCreate))
    return (
      <p className="p-6">You do not have permission to open this workflow.</p>
    );
  if (error)
    return (
      <div role="alert" className="p-6 space-y-3">
        <p>{error}</p>
        <Button onClick={() => setRetry(retry + 1)}>Retry</Button>
        <Button variant="outline" onClick={() => router.push('/automation/workflows')}>Back to workflows</Button>
      </div>
    );
  if (!loaded)
    return (
      <p role="status" className="p-6">
        Loading workflow…
      </p>
    );
  return (
    <WorkflowBuilder
      key={`${tenant?.id}:${id ?? 'new'}:${retry}`}
      {...loaded}
      workflowId={id}
      onCheckName={async (name, excludeId) => (await workflowsApi.nameAvailability(name, excludeId)).data.available}
      canActivate={userCan('workflows', 'canActivate')}
      readOnly={!!id && (!canEdit || query.get('view') === 'true')}
      onClose={() => router.push('/automation/workflows')}
      onPause={id ? () => updateWorkflow(id, { isActive: false }) : undefined}
      onSave={async (draft) => {
        const targetId = id ?? createdId.current;
        const saved = targetId
          ? await updateWorkflow(targetId, draft)
          : await addWorkflow(draft);
        createdId.current = saved.id;
        if (!id) router.replace(`/automation/workflows/${saved.id}/edit`);
        return saved;
      }}
    />
  );
}
