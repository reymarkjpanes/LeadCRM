'use client';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import { useEffect, useRef, useState } from 'react';
import type { TriggerDefinition, WorkflowTestResult } from '@leadcrm/shared';
import { contactsApi } from '@/shared/services/contacts.api';
import { contactsV2Api } from '@/shared/services/contacts-v2.api';
import { dealsApi, type DealResponse } from '@/shared/services/deals.api';
import { companiesApi } from '@/shared/services/companies.api';
import { workflowsApi, withWorkflowTimeout } from '@/shared/services/workflows.api';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { workflowControl } from './workflow-fields';
import { workflowActionLabel } from '../services/workflow-editor';
import { formatDateTime } from '@/shared/components/data-grid/cell-renderers';
import { useAuth } from '@/store/AuthContext';
import { safeMailboxHtml } from '@/features/tenant/inbox/services/email-html';
import { createPageCacheGuard, getPageCacheGeneration, subscribePageCacheInvalidation } from '@/shared/cache/page-cache';

type StageHistory = NonNullable<DealResponse['data']['stageHistories']>[number];
interface WorkflowTestPanelProps {
  workflowId: string;
  trigger: TriggerDefinition;
}

export function WorkflowTestPanel({
  workflowId,
  trigger,
}: WorkflowTestPanelProps) {
  const { user, userCan, permissions } = useAuth();
  const canExecute = userCan('workflows', 'canExecute');
  const [scopeRevision, setScopeRevision] = useState(0);
  const identity = `${user?.tenantId ?? ''}:${user?.id ?? ''}:${workflowId}:${trigger.type}:${JSON.stringify(permissions ?? {})}:${getPageCacheGeneration()}:${scopeRevision}`;
  const generation = useRef(0);
  const stageEvent = ['deal.stage_changed', 'deal.closed_won', 'deal.closed_lost'].includes(trigger.type);
  const [histories, setHistories] = useState<StageHistory[]>([]);
  const [stageHistoryId, setStageHistoryId] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [records, setRecords] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [search, setSearch] = useState(''),
    [selected, setSelected] = useState(''),
    [error, setError] = useState('');
  const [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true),
    [testing, setTesting] = useState(false),
    [result, setResult] = useState<WorkflowTestResult | null>(null);
  useEffect(() => subscribePageCacheInvalidation((module, tenantId) => {
    if (tenantId && tenantId !== user?.tenantId) return;
    if (!['*', 'workflows', 'groups', 'users', `${trigger.entity}s`].includes(module)) return;
    generation.current++;
    setResult(null); setRecords([]); setSelected(''); setHistories([]); setStageHistoryId(''); setTesting(false);
    setPage(1); setHasMore(false); setError(''); setHistoryError('');
    setScopeRevision(value => value + 1);
  }), [user?.tenantId, trigger.entity]);
  useEffect(() => {
    let cancelled = false;
    const validScope = createPageCacheGuard('workflows');
    setLoading(true);
    setSelected('');
    setRecords([]);
    setError('');
    setResult(null);
    setTesting(false);
    generation.current++;
    if (!canExecute) { setLoading(false); return; }
    const timer = setTimeout(async () => {
      try {
        const query = { page, limit: 25, search, archived: false };
        const request = async () => trigger.entity === 'deal'
            ? dealsApi.list(query)
            : trigger.entity === 'account'
              ? companiesApi.list(query)
            : trigger.entity === 'contact'
              ? contactsV2Api.list(query)
              : contactsApi.list(query);
        const response = await withWorkflowTimeout(request());
        if (cancelled || !validScope()) return;
        setRecords(
          response.data.map((record) => ({
            id: record.id,
            name:
              'name' in record ? String(record.name) : 'title' in record
                ? String(record.title)
                : `${record.firstName ?? ''} ${record.lastName ?? ''}`.trim() ||
                  'Unnamed record',
          })),
        );
        setHasMore(response.meta.hasMore);
      } catch (failure) {
        if (!cancelled && validScope())
          setError(
            failure instanceof Error
              ? failure.message
              : 'Unable to load records.',
          );
      } finally {
        if (!cancelled && validScope()) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      generation.current++;
      clearTimeout(timer);
    };
  }, [identity, canExecute, trigger.entity, search, page, retry]);
  useEffect(() => {
    let cancelled = false;
    const validScope = createPageCacheGuard('workflows');
    setHistories([]); setStageHistoryId(''); setHistoryError(''); setHistoryLoading(false);
    if (!canExecute || !stageEvent || !selected) return;
    setHistoryLoading(true);
    withWorkflowTimeout(dealsApi.get(selected)).then(response => {
      if (!cancelled && validScope()) setHistories((response.data.stageHistories ?? []).filter(history => history.previousStage && history.previousStage.id !== history.newStage.id));
    }).catch(failure => {
      if (!cancelled && validScope()) setHistoryError(failure instanceof Error ? failure.message : 'Unable to load recorded stage transitions.');
    }).finally(() => { if (!cancelled && validScope()) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [identity, canExecute, selected, stageEvent, retry]);
  async function test() {
    if (testing || !canExecute) return;
    const current = ++generation.current;
    const validScope = createPageCacheGuard('workflows');
    setTesting(true);
    setError('');
    setResult(null);
    try {
      const response = await workflowsApi.test(workflowId, selected, stageHistoryId || undefined);
      if (generation.current === current && validScope()) setResult(response.data);
    } catch (failure) {
      if (generation.current === current && validScope()) setError(
        failure instanceof Error ? failure.message : 'Unable to test workflow.',
      );
    } finally {
      if (generation.current === current && validScope()) setTesting(false);
    }
  }
  if (!canExecute) return <p className="text-sm">You do not have permission to run workflow checks.</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted-foreground)]">
        Check the saved workflow against a {trigger.entity}. No actions run or messages are sent.
        Recorded transitions use current record values.
      </p>
      <Input
        aria-label="Search test records"
        placeholder="Search records by name…"
        disabled={testing}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {loading ? (
        <TableLoadingState label="Loading records…" />
      ) : (
        <label className="block text-sm">
          Sample record
          <select
            className={workflowControl}
            disabled={testing}
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              setResult(null);
            }}
          >
            <option value="">Choose a record</option>
            {records.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </select>
          {!records.length && (
            <span className="mt-2 block text-[var(--muted-foreground)]">
              No matching records are available.
            </span>
          )}
        </label>
      )}
      {stageEvent && selected && <div className="space-y-2">
        <label className="block text-sm">Recorded stage transition
          <select className={workflowControl} value={stageHistoryId} disabled={testing || historyLoading || !!historyError} onChange={event => { setStageHistoryId(event.target.value); setResult(null); }}>
            <option value="">Current record check only</option>
            {histories.map(history => <option key={history.id} value={history.id}>{history.previousStage!.name} → {history.newStage.name} · {formatDateTime(history.movedAt, { seconds: true })}</option>)}
          </select>
        </label>
        {historyLoading && <TableLoadingState label="Loading recorded transitions…" />}
        {historyError && <p role="alert" className="text-sm text-destructive">{historyError}</p>}
        {!historyLoading && !historyError && !histories.length && <p className="text-sm text-muted-foreground">No recorded stage transitions are available. A current record check cannot match stage-event conditions.</p>}
        <p className="text-sm text-muted-foreground">Choose a recorded transition to evaluate its event conditions. A superseded entry is skipped.</p>
      </div>}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || testing || page === 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm">Page {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || testing || !hasMore}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button variant="ghost" onClick={() => setRetry(retry + 1)}>
            Reload records
          </Button>
        </div>
      )}
      <Button
        disabled={!selected || testing || loading || historyLoading}
        onClick={() => void test()}
      >
        {testing ? 'Checking…' : 'Run check'}
      </Button>
      {result && (
        <div
          role="status"
          className="space-y-3 rounded-xl border border-[var(--border)] p-4"
        >
          <h3 className="font-semibold">
            {result.valid
              ? 'Configuration is valid'
              : 'Configuration needs attention'}
          </h3>
          <p className="text-sm">
            {result.trigger.reason ?? (result.trigger.matched
              ? 'Sample record matches the trigger’s record type.'
              : 'Sample record does not match the trigger’s record type.')}
          </p>
          <p className="text-sm">
            {result.conditions.matched
              ? 'Conditions match. Review the action checks below.'
              : 'Conditions do not match — actions would be skipped.'}{' '}
            ({result.conditions.passed}/{result.conditions.total} rules match)
          </p>
          {result.trigger.stageHistoryId && <p className="text-sm">Recorded transition checked against current state. No execution or Task was created.</p>}
          {result.trigger.requiresEvent && !result.trigger.stageHistoryId && <p className="text-sm">This check uses current record values. The workflow runs only after a matching update or stage transition.</p>}
          <ol className="space-y-2 text-sm">
            {result.actions.map((action, index) => (
              <li key={index}>
                {index + 1}. {workflowActionLabel(action.type)}:{' '}
                {action.message}
                {action.taskPreview && <dl className="mt-2 space-y-1 rounded-lg bg-muted/40 p-3 [overflow-wrap:anywhere]">
                  <div><dt className="sr-only">Result: </dt><dd className="font-medium">{action.taskPreview.associationSummary ?? `Creates 1 task linked to ${action.taskPreview.dealIds.length} deal${action.taskPreview.dealIds.length === 1 ? '' : 's'}.`}</dd></div>
                  <div><dt className="inline font-medium">Title: </dt><dd className="inline">{action.taskPreview.title}</dd></div>
                  {action.taskPreview.description && <div><dt className="inline font-medium">Description: </dt><dd className="inline whitespace-pre-wrap">{action.taskPreview.description}</dd></div>}
                  <div><dt className="inline font-medium">Priority / status: </dt><dd className="inline">{action.taskPreview.priority} / {action.taskPreview.status}</dd></div>
                  <div><dt className="inline font-medium">Due (Asia/Manila): </dt><dd className="inline">{formatDateTime(action.taskPreview.dueDate)}. Calculated from this check; execution uses its own start time.</dd></div>
                  <div><dt className="inline font-medium">Assigned Agent: </dt><dd className="inline">{action.assignment?.resolvedUserName ?? action.taskPreview.assignedUserId}</dd></div>
                  <div><dt className="inline font-medium">Deals: </dt><dd className="inline">{action.taskPreview.deals?.map(deal => deal.title).join(', ') || action.taskPreview.dealIds.join(', ')}</dd></div>
                </dl>}
                {action.emailPreview && <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3 [overflow-wrap:anywhere]">
                  <p><span className="font-medium">From: </span>{action.emailPreview.senderName} &lt;{action.emailPreview.senderEmail}&gt;</p>
                  <p><span className="font-medium">To: </span>{action.emailPreview.recipient}</p>
                  <p><span className="font-medium">Subject: </span>{action.emailPreview.subject}</p>
                  <iframe title={`Email message preview ${index + 1}`} sandbox="" className="min-h-48 w-full rounded border border-border bg-white" srcDoc={`<!doctype html><html><head><meta name="referrer" content="no-referrer"><style>body{font:14px/1.6 system-ui;overflow-wrap:anywhere}img,table{max-width:100%}</style></head><body>${safeMailboxHtml(action.emailPreview.body)}</body></html>`} />
                  <p className="text-xs text-muted-foreground">Preview only. No email was sent.</p>
                </div>}
                {!!(action.warnings?.length || action.emailPreview?.warnings.length) && <ul className="mt-2 list-inside list-disc text-sm text-amber-800 dark:text-amber-200">{(action.warnings ?? action.emailPreview?.warnings ?? []).map(warning => <li key={warning}>{warning}</li>)}</ul>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
