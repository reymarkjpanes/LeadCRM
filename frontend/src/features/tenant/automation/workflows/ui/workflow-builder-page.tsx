'use client';
import { useEffect, useRef, useState } from 'react';
import { getWorkflowConditionFields, WORKFLOW_MODULES } from '@leadcrm/shared';
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
import { useReadRecordNotifications } from '@/features/tenant/notifications/hooks/use-record-notifications';
import {
  getWorkflowMetadata,
  withWorkflowTimeout,
  workflowsApi,
} from '@/shared/services/workflows.api';
import { subscribePageCacheInvalidation } from '@/shared/cache/page-cache';
import { Button } from '@/shared/components/ui/button';
import WorkflowBuilder from './visual-workflow-builder';
import { resolveWorkflowTemplate } from '../services/workflow-stage-templates';
const workflowOptionModules = new Set(['settings', 'field-layout', 'leads', 'contacts', 'accounts', 'deals', 'pipeline', 'pipelines', 'products', 'users', 'groups', 'roles', 'templates']);
function conditionTriggers(triggers: TriggerDefinition[], options: WorkflowOptions) {
  return triggers.map(trigger => ({ ...trigger, fields: getWorkflowConditionFields(trigger.entity, trigger.type, options.customFields, options.fieldLayouts?.[WORKFLOW_MODULES[trigger.entity]]) }));
}
export default function WorkflowBuilderPage() {
  const router = useRouter(),
    params = useParams<{ id?: string }>(),
    query = useSearchParams();
  const { tenant, user, userCan, isLoading, authError, retryAuthInit } = useAuth();
  const { addWorkflow, updateWorkflow } = useData();
  const [loaded, setLoaded] = useState<{
    scope: string;
    initial: WorkflowDraft;
    options: WorkflowOptions;
    triggers: TriggerDefinition[];
    actions: ActionDefinition[];
    initialStatus?: Workflow['status'];
    initialVersion?: number;
  } | null>(null);
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const [optionsError, setOptionsError] = useState('');
  const canView = userCan('workflows', 'canView'),
    canEdit = userCan('workflows', 'canEdit'),
    canCreate = userCan('workflows', 'canCreate');
  const id = params.id === 'new' ? undefined : params.id,
    recipe = query.get('template');
  const revisionTokens = useRef({ draft: 0, version: 1 });
  const createdId = useRef<string | undefined>(undefined);
  const triggerCatalog = useRef<TriggerDefinition[]>([]);
  const retryOptions = useRef<() => void>(() => {});
  const scope = `${tenant?.id ?? ''}:${user?.id ?? ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const optionsLoaded = loaded !== null;
  useReadRecordNotifications('Workflow', id, canView && !!loaded && loaded.scope === scope && !isLoading && !authError && !error);
  useEffect(() => {
    if (!tenant?.id || !canView || !optionsLoaded) return;
    let cancelled = false, pending = false, queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshOptions = async () => {
      if (cancelled || currentScope.current !== scope) return;
      if (pending) { queued = true; return; }
      pending = true;
      try {
        const response = await withWorkflowTimeout(workflowsApi.options());
        if (!cancelled && !queued && currentScope.current === scope) {
          setLoaded(current => current ? { ...current, options: response.data, triggers: conditionTriggers(triggerCatalog.current, response.data) } : current);
          setOptionsError('');
        }
      } catch (failure) {
        if (!cancelled && !queued && currentScope.current === scope) {
          const status = (failure as { status?: number })?.status;
          if (status === 401 || status === 403) {
            setLoaded(current => current ? { ...current, options: { users: [], pipelines: [], templates: [], campaigns: [], customFields: [] }, triggers: [] } : current);
          }
          setOptionsError('Workflow choices could not refresh. Your edits are preserved. Retry before saving.');
        }
      } finally {
        pending = false;
        if (queued && !cancelled) { queued = false; void refreshOptions(); }
      }
    };
    const scheduleRefresh = () => { if (pending) { queued = true; return; } clearTimeout(timer); timer = setTimeout(() => void refreshOptions(), 0); };
    retryOptions.current = scheduleRefresh;
    const wake = () => { if (document.visibilityState !== 'hidden') scheduleRefresh(); };
    const unsubscribe = subscribePageCacheInvalidation((module, changedTenant) => {
      if ((!changedTenant || changedTenant === tenant.id) && (module === '*' || workflowOptionModules.has(module))) scheduleRefresh();
    });
    window.addEventListener('leadcrm:groups-changed', scheduleRefresh);
    window.addEventListener('leadcrm:users-changed', scheduleRefresh);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      cancelled = true; clearTimeout(timer); unsubscribe();
      retryOptions.current = () => {};
      window.removeEventListener('leadcrm:groups-changed', scheduleRefresh);
      window.removeEventListener('leadcrm:users-changed', scheduleRefresh);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [tenant?.id, scope, canView, optionsLoaded]);
  useEffect(() => {
    if (!tenant?.id || !canView || (!id && !canCreate)) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      cancelled = true;
      setError('Workflow loading timed out. Check your connection and retry.');
    }, 30000);
    setLoaded(null);
    setError('');
    setOptionsError('');
    triggerCatalog.current = [];
    createdId.current = undefined;
    Promise.all([
      getWorkflowMetadata(
        `${tenant.id}:${user?.id}`,
      ),
      workflowsApi.options(),
      id ? workflowsApi.get(id) : Promise.resolve(null),
    ])
      .then(([metadata, options, response]) => {
        if (cancelled || currentScope.current !== scope) return;
        triggerCatalog.current = metadata.triggers;
        const saved = response?.data;
        revisionTokens.current = { draft: saved?.draftRevision ?? 0, version: saved?.version ?? 1 };
        const editing = saved?.draftDefinition ?? saved;
        const selected = recipe === null ? undefined : resolveWorkflowTemplate(recipe, options.data);
        if (!saved && recipe !== null && !selected) {
          throw new Error('This workflow template is unavailable. Return to workflows and choose another template.');
        }
        const initial: WorkflowDraft = saved
          ? {
              name: editing!.name,
              description: editing!.description,
              trigger: editing!.trigger,
              conditions: editing!.conditions,
              actions: editing!.actions,
              isActive: saved.isActive,
            }
          : selected
            ? selected.recipe
            : {
                name: '',
                description: '',
                trigger: '',
                isActive: false,
                actions: [],
              };
        setLoaded({
          scope,
          initial,
          initialStatus: saved?.status,
          initialVersion: saved?.version,
          options: options.data,
          ...metadata,
          triggers: conditionTriggers(metadata.triggers, options.data),
        });
      })
      .catch((failure) => {
        if (!cancelled && currentScope.current === scope)
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
  if (!loaded || loaded.scope !== scope)
    return (
      <WorkflowBuilderSkeleton />
    );
  return (
    <>
    {optionsError && <div role="alert" className="px-5 py-3 text-sm">{optionsError} <Button variant="outline" size="sm" onClick={() => retryOptions.current()}>Retry choices</Button></div>}
    <WorkflowBuilder
      key={`${scope}:${id ?? 'new'}:${retry}`}
      {...loaded}
      templateIndex={!id && recipe !== null && /^(0|[1-9]\d*)$/.test(recipe) ? Number(recipe) : undefined}
      templateIdentity={!id && recipe !== null ? recipe : undefined}
      workflowId={id}
      onCheckName={async (name, excludeId) => (await workflowsApi.nameAvailability(name, excludeId)).data.available}
      canActivate={userCan('workflows', 'canActivate')}
      canPause={userCan('workflows', 'canPause')}
      canExecute={userCan('workflows', 'canExecute')}
      canViewRuns={userCan('workflows', 'canViewRuns')}
      readOnly={!!id && (!canEdit || query.get('view') === 'true')}
      onClose={() => router.push('/automation/workflows')}
      onPause={id ? async () => (await workflowsApi.toggle(id, false)).data : undefined}
      onRestoreVersion={id ? async version => { await workflowsApi.restoreVersion(id, version, revisionTokens.current.draft, revisionTokens.current.version); setRetry(value => value + 1); } : undefined}
      onSave={async (draft) => {
        const targetId = id ?? createdId.current;
        const saved = targetId
          ? (await (draft.isActive ? workflowsApi.publishDraft(targetId, draft, revisionTokens.current.draft, revisionTokens.current.version) : workflowsApi.saveDraft(targetId, draft, revisionTokens.current.draft, revisionTokens.current.version))).data
          : await addWorkflow(draft);
        revisionTokens.current = { draft: saved.draftRevision ?? 0, version: saved.version ?? 1 };
        createdId.current = saved.id;
        if (!id) router.replace(`/automation/workflows/${saved.id}/edit`);
        return saved;
      }}
    />
    </>
  );
}
