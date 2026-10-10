'use client';
import { useEffect, useRef, useState } from 'react';
import { getWorkflowConditionFields } from '@leadcrm/shared';
import { WorkflowBuilderSkeleton } from './workflow-builder-skeleton';
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
import { toast } from 'sonner';
export default function WorkflowBuilderPage() {
  const router = useRouter(),
    params = useParams<{ id?: string }>(),
    query = useSearchParams();
  const { tenant, user, userCan, isLoading, authError, retryAuthInit } = useAuth();
  const { addWorkflow, updateWorkflow } = useData();
  const [loaded, setLoaded] = useState<{
    initial: WorkflowDraft;
    options: WorkflowOptions;
    triggers: TriggerDefinition[];
    actions: ActionDefinition[];
    initialStatus?: Workflow['status'];
    initialVersion?: number;
  } | null>(null);
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const canView = userCan('workflows', 'canView'),
    canEdit = userCan('workflows', 'canEdit'),
    canCreate = userCan('workflows', 'canCreate');
  const id = params.id === 'new' ? undefined : params.id,
    recipe = query.get('template');
  const createdId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!tenant?.id || !canView) return;
    let cancelled = false, pending = false;
    const refreshOptions = () => {
      if (pending) return;
      pending = true;
      workflowsApi.options().then(response => {
        if (!cancelled) setLoaded(current => current ? { ...current, options: response.data } : current);
      }).catch(() => {
        if (!cancelled) toast.error('Assignment choices could not refresh. Your workflow edits are preserved.');
      }).finally(() => { pending = false; });
    };
    window.addEventListener('leadcrm:groups-changed', refreshOptions);
    return () => { cancelled = true; window.removeEventListener('leadcrm:groups-changed', refreshOptions); };
  }, [tenant?.id, canView]);
  useEffect(() => {
    if (!tenant?.id || !canView || (!id && !canCreate)) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      cancelled = true;
      setError('Workflow loading timed out. Check your connection and retry.');
    }, 30000);
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
          initialVersion: saved?.version,
          options: options.data,
          ...metadata,
          triggers: metadata.triggers.map(trigger => ({ ...trigger, fields: getWorkflowConditionFields(trigger.entity, trigger.type, options.data.customFields) })),
        });
      })
      .catch((failure) => {
        if (!cancelled)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Unable to load workflow.',
          );
      }).finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
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
  if (isLoading) return <WorkflowBuilderSkeleton />;
  if (authError || !tenant?.id) return <div role="alert" className="p-6 space-y-3"><p>{authError || 'Your workspace is unavailable. Reload your session to continue.'}</p><Button onClick={() => void retryAuthInit()}>Retry</Button><Button variant="outline" onClick={() => router.push('/automation/workflows')}>Back to workflows</Button></div>;
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
      <WorkflowBuilderSkeleton />
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
