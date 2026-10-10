'use client';
import { TableLoadingState } from '@/shared/components/crm/table-loading-state';
import { useEffect, useState } from 'react';
import type { TriggerDefinition, WorkflowTestResult } from '@leadcrm/shared';
import { contactsApi } from '@/shared/services/contacts.api';
import { contactsV2Api } from '@/shared/services/contacts-v2.api';
import { dealsApi } from '@/shared/services/deals.api';
import { companiesApi } from '@/shared/services/companies.api';
import { workflowsApi, withWorkflowTimeout } from '@/shared/services/workflows.api';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { workflowControl } from './workflow-fields';
import { workflowActionLabel } from '../services/workflow-editor';

export function WorkflowTestPanel({
  workflowId,
  trigger,
}: {
  workflowId: string;
  trigger: TriggerDefinition;
}) {
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
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelected('');
    setError('');
    setResult(null);
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
        if (cancelled) return;
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
        if (!cancelled)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Unable to load records.',
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trigger.entity, search, page, retry]);
  async function test() {
    setTesting(true);
    setError('');
    setResult(null);
    try {
      setResult((await workflowsApi.test(workflowId, selected)).data);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Unable to test workflow.',
      );
    } finally {
      setTesting(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted-foreground)]">
        Check the saved workflow against a real{' '}
        {trigger.entity}. No
        actions are executed and no messages are sent. This does not simulate a
        new CRM event.
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
        disabled={!selected || testing || loading}
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
            {result.trigger.matched
              ? 'Sample record matches the trigger’s record type.'
              : 'Sample record does not match the trigger’s record type.'}
          </p>
          <p className="text-sm">
            {result.conditions.matched
              ? 'Conditions match. Review the action checks below.'
              : 'Conditions do not match — actions would be skipped.'}{' '}
            ({result.conditions.passed}/{result.conditions.total} rules match)
          </p>
          {result.trigger.requiresEvent && <p className="text-sm">This check uses current record values. The workflow runs only after a matching update or stage transition.</p>}
          <ol className="space-y-2 text-sm">
            {result.actions.map((action, index) => (
              <li key={index}>
                {index + 1}. {workflowActionLabel(action.type)}:{' '}
                {action.message}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
