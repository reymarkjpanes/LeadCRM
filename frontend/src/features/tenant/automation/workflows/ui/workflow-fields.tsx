'use client';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type {
  ActionDefinition,
  WorkflowAction,
  WorkflowCondition,
  WorkflowOptions,
  TriggerDefinition,
  WorkflowEntity,
} from '@leadcrm/shared';
import { getWorkflowUpdateFields, workflowOperators, WORKFLOW_MESSAGE_VARIABLES } from '@leadcrm/shared';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { operatorLabels, references, retiredActionLabels } from '../services/workflow-editor';
import { WorkflowAssignmentFields } from './workflow-assignment-fields';
export const workflowControl =
  'w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 text-sm text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]';
export const emptyOptions: WorkflowOptions = {
  users: [],
  pipelines: [],
  templates: [],
  campaigns: [],
};
export const referenceOptions = references;

function UpdateFieldFields({ action, options, entity, onChange }: {
  action: WorkflowAction; options: WorkflowOptions; entity?: WorkflowEntity;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const fields = entity ? getWorkflowUpdateFields(entity, options.customFields) : [];
  const field = fields.find((entry) => entry.field === action.config.field);
  const [group, setGroup] = useState<'standard' | 'custom'>(field?.group === 'custom' ? 'custom' : 'standard');
  const selectedGroup = field?.group ?? group;
  const value = action.config.value;
  const change = (patch: Record<string, unknown>) => onChange({ ...action.config, ...patch });
  const optionsForField = field?.options?.map((option) => ({ id: option, name: field?.optionLabels?.[option] ?? option })) ?? references(field?.type ?? '', options);
  const multiple = ['products', 'contacts', 'leads'].includes(field?.type ?? '');
  const choices = optionsForField;
  const selected = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  const othersSelected = field?.type === 'products' && choices?.some((choice) => choice.name.trim().toLowerCase() === 'others' && selected.includes(choice.id));
  return <div className="space-y-4">
    <label className="block space-y-1">Field group
      <select aria-label="Field group" className={workflowControl} value={selectedGroup} onChange={(event) => {
        setGroup(event.target.value as 'standard' | 'custom');
        onChange({ field: '', value: '' });
      }}>
        <option value="standard">Standard Fields</option>
        {fields.some((entry) => entry.group === 'custom') && <option value="custom">Custom Fields</option>}
      </select>
    </label>
    <label className="block space-y-1">Field
      <select aria-label="Field" className={workflowControl} value={String(action.config.field ?? '')} onChange={(event) => {
        const next = fields.find((entry) => entry.field === event.target.value);
        onChange({ field: event.target.value, value: next?.type === 'boolean' ? false : ['products', 'contacts', 'leads'].includes(next?.type ?? '') ? [] : '' });
      }}>
        <option value="">Choose a field</option>
        {fields.filter((entry) => (entry.group ?? 'standard') === selectedGroup).map((entry) => <option key={entry.field} value={entry.field}>{entry.label}</option>)}
        {action.config.field && !field ? <option value={String(action.config.field)}>Unavailable field</option> : null}
      </select>
    </label>
    {!!action.config.field && !field && <p role="status" className="text-sm text-[var(--muted-foreground)]">This field is no longer available. Choose a supported field, disable the action, or remove it before activating.</p>}
    {entity === 'lead' && !!action.config.otherDetails && <div role="status" className="text-sm text-[var(--muted-foreground)]">Additional Product details are retired for Leads. Saved setting: {String(action.config.otherDetails)} <Button type="button" variant="outline" onClick={() => { const { otherDetails: _retired, ...config } = action.config; onChange(config); }}>Remove retired setting</Button></div>}
    {entity === 'deal' && <p className="text-xs text-[var(--muted-foreground)]">A Deal keeps its original Product and value. Create a new Deal for a new opportunity.</p>}
    {field && !field.required && <label className="flex items-center gap-2"><input type="checkbox" checked={!!action.config.clear} onChange={(event) => change({ clear: event.target.checked })} />Clear this field</label>}
    {field && !action.config.clear && <div className="space-y-2">
      {multiple ? <fieldset className="space-y-2"><legend className="mb-2">New value</legend><div className="max-h-56 overflow-auto rounded-lg border border-[var(--border)] p-2">
        {choices?.map((choice) => <label className="flex min-h-10 items-center gap-2" key={choice.id}><input type="checkbox" checked={selected.includes(choice.id)} onChange={(event) => {
          const next = event.target.checked ? [...selected, choice.id] : selected.filter((entry) => entry !== choice.id);
          change({ value: next, ...(choice.name.trim().toLowerCase() === 'others' && !event.target.checked ? { otherDetails: '' } : {}) });
        }} /><span className="min-w-0 break-words">{choice.name}</span></label>)}
        {selected.filter(id => !choices?.some(choice => choice.id === id)).map(id => <label key={id} className="flex min-h-10 items-center gap-2"><input type="checkbox" checked onChange={() => change({ value: selected.filter(value => value !== id) })} />Unavailable selection</label>)}
        {!choices?.length && <p className="text-xs text-[var(--muted-foreground)]">No available selections.</p>}
      </div></fieldset> : <label className="block space-y-1">New value
        {field.type === 'boolean' ? <select aria-label="New value" className={workflowControl} value={String(value ?? false)} onChange={(event) => change({ value: event.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></select>
          : choices ? <select aria-label="New value" className={workflowControl} value={String(value ?? '')} onChange={(event) => change({ value: event.target.value })}><option value="">Choose…</option>{value && !choices.some(choice => choice.id === value) ? <option value={String(value)}>Unavailable selection</option> : null}{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>
            : field.type === 'list' ? <textarea aria-label="New value" className={workflowControl} rows={4} placeholder="One value per line" value={Array.isArray(value) ? value.join('\n') : ''} onChange={(event) => change({ value: event.target.value.split('\n') })} />
            : ['number', 'date'].includes(field.type) ? <Input aria-label="New value" type={field.type === 'number' ? 'number' : 'date'} step="any" value={String(value ?? '')} onChange={(event) => change({ value: field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value })} />
              : <textarea aria-label="New value" className={workflowControl} rows={field.multiline ? 4 : 2} maxLength={field.maxLength ?? 1000} value={String(value ?? '')} onChange={(event) => change({ value: event.target.value })} />}
      </label>}
      {entity !== 'lead' && othersSelected && <label className="block space-y-1">Specify (optional)<Input aria-label="Specify (optional)" maxLength={1000} value={String(action.config.otherDetails ?? '')} onChange={(event) => change({ otherDetails: event.target.value })} /><span className="block text-xs text-[var(--muted-foreground)]">Others counts as a selected interest even without additional details.</span></label>}
      {field.type === 'stage' && <label className="block space-y-1">Lost reason (for a lost stage)<Input aria-label="Lost reason" value={String(action.config.lostReason ?? '')} onChange={(event) => change({ lostReason: event.target.value })} /></label>}
    </div>}
  </div>;
}
export function ConditionFields({
  value,
  trigger,
  options,
  onChange,
}: {
  value: WorkflowCondition;
  trigger?: TriggerDefinition;
  options: WorkflowOptions;
  onChange: (value: WorkflowCondition) => void;
}) {
  return (
    <div className="space-y-4 text-sm">
      <label className="block space-y-1">
        Match conditions
        <select
          className={workflowControl}
          value={value.operator}
          onChange={(event) =>
            onChange({ ...value, operator: event.target.value as 'AND' | 'OR' })
          }
        >
          <option value="AND">All conditions (AND)</option>
          <option value="OR">Any condition (OR)</option>
        </select>
      </label>
      {value.conditions.map((rule, index) => {
        const field = trigger?.fields.find(
          (field) => field.field === rule.field,
        );
        const rawChoices =
          field?.options?.map((option) => ({ id: option, name: field?.optionLabels?.[option] ?? option })) ??
          references(field?.type ?? '', options);
        const choices = rawChoices;
        const update = (patch: Partial<typeof rule>) =>
          onChange({
            ...value,
            conditions: value.conditions.map((entry, i) =>
              i === index ? { ...entry, ...patch } : entry,
            ),
          });
        return (
          <div
            key={index}
            className="space-y-3 rounded-xl border border-[var(--border)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--muted-foreground)]">Condition {index + 1}</p>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== index) })} aria-label={`Remove condition ${index + 1}`} title="Remove condition">
                <Trash2 size={16} aria-hidden="true" />
              </Button>
            </div>
            <label className="block">
              <span>Field <span className="text-red-500" aria-hidden="true">*</span></span>
              <select
                aria-label={`Condition ${index + 1} field`}
                aria-required="true"
                className={workflowControl}
                value={rule.field}
                onChange={(event) => {
                  const next = trigger?.fields.find(
                    (field) => field.field === event.target.value,
                  );
                  update({
                    field: event.target.value,
                    operator: workflowOperators(next?.type ?? 'string')[0],
                    value:
                      next?.type === 'number'
                        ? 0
                        : next?.type === 'boolean'
                          ? false
                          : '',
                  });
                }}
              >
                <option value="">Choose a field</option>
                {rule.field && !field && <option value={rule.field}>Unavailable field — repair required</option>}
                {(['standard', 'custom'] as const).map(group => <optgroup key={group} label={group === 'custom' ? 'Custom Fields' : 'Standard Fields'}>{trigger?.fields.filter(field => (field.group ?? 'standard') === group).map(field => <option key={field.field} value={field.field}>{field.label}</option>)}</optgroup>)}
              </select>
            </label>
            <label className="block">
              Operator
              <select
                aria-label={`Condition ${index + 1} operator`}
                className={workflowControl}
                value={rule.operator}
                onChange={(event) =>
                  update({
                    operator: event.target.value as typeof rule.operator,
                  })
                }
              >
                {workflowOperators(field?.type ?? 'string').map((operator) => (
                  <option key={operator} value={operator}>
                    {operatorLabels[operator]}
                  </option>
                ))}
              </select>
            </label>
            {!['is_empty', 'is_not_empty'].includes(rule.operator) && (
              <label className="block">
                <span>Value <span className="text-red-500" aria-hidden="true">*</span></span>
                {field?.type === 'boolean' ? (
                  <select
                    className={workflowControl}
                    aria-label={`Condition ${index + 1} value`}
                    aria-required="true"
                    value={String(rule.value)}
                    onChange={(event) =>
                      update({ value: event.target.value === 'true' })
                    }
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : choices ? (
                  <select
                    aria-label={`Condition ${index + 1} value`}
                    aria-required="true"
                    className={workflowControl}
                    value={String(rule.value ?? '')}
                    onChange={(event) => update({ value: event.target.value })}
                  >
                    <option value="">Choose…</option>
                    {rule.value && !choices.some(choice => choice.id === rule.value) ? <option value={String(rule.value)}>Unavailable selection</option> : null}
                    {choices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.name}
                      </option>
                    ))}
                  </select>
                ) : field?.multiline ? <textarea aria-label={`Condition ${index + 1} value`} aria-required="true" className={workflowControl} rows={4} maxLength={field.maxLength} value={String(rule.value ?? '')} onChange={event => update({ value: event.target.value })} /> : (
                  <Input
                    aria-label={`Condition ${index + 1} value`}
                    aria-required="true"
                    type={
                      field?.type === 'number'
                        ? 'number'
                        : field?.type === 'date'
                          ? 'date'
                          : 'text'
                    }
                    maxLength={field?.maxLength ?? 1000}
                    value={String(rule.value ?? '')}
                    onChange={(event) =>
                      update({
                        value:
                          field?.type === 'number' && event.target.value !== ''
                            ? Number(event.target.value)
                            : event.target.value,
                      })
                    }
                  />
                )}
              </label>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="default"
        onClick={() =>
          onChange({
            ...value,
            conditions: [
              ...value.conditions,
              {
                field: trigger?.fields[0]?.field ?? '',
                operator: workflowOperators(trigger?.fields[0]?.type ?? 'string')[0],
                value: trigger?.fields[0]?.type === 'number' ? 0 : '',
              },
            ],
          })
        }
        disabled={!trigger || value.conditions.length >= 30}
      >
        Add condition
      </Button>
    </div>
  );
}
export function ActionFields({
  action,
  definition,
  options,
  entity,
  onChange,
}: {
  action: WorkflowAction;
  definition?: ActionDefinition;
  options: WorkflowOptions;
  entity?: WorkflowEntity;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const [pipeline, setPipeline] = useState('');
  const selectedPipeline =
    options.pipelines.find((entry) =>
      entry.stages.some((stage) => stage.id === action.config.stageId),
    )?.id ?? pipeline;
  if (retiredActionLabels[action.type]) return <p role="status" className="rounded-lg border border-amber-300 p-3 text-sm">{action.type === 'create_notification' ? 'Notifications are automatic.' : 'Send Campaign is no longer available in workflows.'} This saved step is preserved. Disable or remove it before activating the workflow.</p>;
  if (action.type === 'update_field') return <UpdateFieldFields action={action} options={options} entity={entity} onChange={onChange} />;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-[var(--muted-foreground)]">{definition?.description}</p>
      {['create_task', 'assign_owner'].includes(action.type) && <WorkflowAssignmentFields action={action} entity={entity} options={options} className={workflowControl} onChange={onChange} />}
      {action.type === 'send_sms' && options.smsConfigured === false && <p role="status" className="rounded-lg border border-amber-300 p-3 text-sm">SMS is not configured. You can save this draft and connect SMS before activating it.</p>}
      {action.type === 'move_deal_stage' && (
        <label className="block space-y-1">
          Pipeline
          <select
            className={workflowControl}
            value={selectedPipeline}
            onChange={(event) => {
              setPipeline(event.target.value);
              onChange({ ...action.config, stageId: '', currentStageId: '' });
            }}
          >
            <option value="">All pipelines</option>
            {options.pipelines.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <span className="block text-xs text-[var(--muted-foreground)]">
            The deal must meet the selected stage’s entry requirements.
          </span>
        </label>
      )}
      {Object.entries(definition?.configSchema ?? {}).map(([key, field]) => {
        if (field.type === 'assignment' || (action.type === 'create_task' && key === 'assignedUserId') || (action.type === 'assign_owner' && key === 'userId')) return null;
        if (action.type === 'move_deal_stage' && entity === 'deal' && ['targetMode', 'productInterestId', 'currentStageId'].includes(key)) return null;
        let choices = key === 'senderUserId' ? options.senders ?? [] :
          references(field.type, options) ??
          field.options?.map((option) => ({ id: option, name: option }));
        if (['stageId', 'currentStageId'].includes(key) && selectedPipeline)
          choices =
            options.pipelines.find((entry) => entry.id === selectedPipeline)
              ?.stages ?? [];
        if (action.type === 'send_sms' && key === 'recipient') choices = (choices ?? []).filter((choice) => entity === 'deal' ? choice.id !== 'record' : entity === 'account' ? choice.id === 'primary_contact' : choice.id === 'record').map((choice) => ({ ...choice, name: choice.id === 'record' ? 'Triggering record' : choice.id === 'primary_contact' ? 'Primary contact' : 'Primary lead' }));
        if (key === 'targetMode') choices = [{ id: 'single_match', name: 'One matching Deal (default)' }, { id: 'all_matching', name: 'All matching related Deals' }];
        const change = (value: unknown) =>
          onChange({ ...action.config, [key]: value });
        const value = String(action.config[key] ?? '');
        const variable = ['title', 'description', 'subject', 'body', 'message'].includes(
          key,
        );
        return (
          <div key={key} className="space-y-2">
            <label className="block space-y-1">
              <span>
                {field.label}
                {field.required && <span className="text-red-600"> *</span>}
              </span>
              {choices ? (
                <select
                  aria-label={field.label}
                  className={workflowControl}
                  value={value}
                  onChange={(event) => change(event.target.value)}
                >
                  <option value="">
                    {['assignedUserId', 'userId'].includes(key) &&
                    !field.required
                      ? 'Current record agent'
                      : 'Choose…'}
                  </option>
                  {value && !choices.some((choice) => choice.id === value) && (
                    <option value={value}>Unavailable selection</option>
                  )}
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                    </option>
                  ))}
                </select>
              ) : ['body', 'description', 'value', 'message'].includes(key) ? (
                <textarea
                  aria-label={field.label}
                  className={workflowControl}
                  rows={4}
                  maxLength={10000}
                  value={value}
                  onChange={(event) => change(event.target.value)}
                />
              ) : (
                <Input
                  aria-label={field.label}
                  type={field.type === 'number' ? 'number' : 'text'}
                  min={0}
                  max={365}
                  maxLength={255}
                  value={value}
                  onChange={(event) =>
                    change(
                      field.type === 'number' && event.target.value !== ''
                        ? Number(event.target.value)
                        : event.target.value,
                    )
                  }
                />
              )}
            </label>
            {choices?.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                No available {field.label.toLowerCase()} options.
              </p>
            )}
            {key === 'dueDaysFromNow' && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Leave empty for 3 days. Use 0 for today or 1 for tomorrow.
              </p>
            )}
            {variable && (
              <div
                className="flex flex-wrap gap-1"
                aria-label={`Personalize ${field.label}`}
              >
                {WORKFLOW_MESSAGE_VARIABLES.map(({ token, label }) => (
                  <button
                    key={token}
                    type="button"
                    title={`Append ${label.toLowerCase()}`}
                    className="rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onClick={() => change(`${value}{{${token}}}`)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
