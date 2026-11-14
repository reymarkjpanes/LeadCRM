'use client';
import { workflowRecordTextSchema, workflowTaskTextError } from '../services/workflow-editor';
import { textFieldError } from '@/shared/utils/text-field-validation';
import { useId, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type {
  ActionDefinition,
  WorkflowAction,
  WorkflowCondition,
  WorkflowOptions,
  TriggerDefinition,
  WorkflowEntity,
  WorkflowDraft,
} from '@leadcrm/shared';
import { conditionOperatorLabel, conditionOperatorValueShape, missingWorkflowConditionValues, getWorkflowUpdateFields, getWorkflowMessageVariables, workflowMessageEntity, WORKFLOW_MODULES, workflowOperators } from '@leadcrm/shared';
import { transitionConditionField, transitionConditionOperator } from '@/shared/services/condition-editor';
import { Button } from '@/shared/components/ui/button';
import { ConditionFieldSelect, ConditionOperatorSelect, ConditionScalarInput } from '@/shared/components/condition-controls';
import { Input, textFieldClassName } from '@/shared/components/ui/input';
import { cn } from '@/lib/utils';
import { conditionRuleIssue, newWorkflowCondition, references, retiredActionLabels } from '../services/workflow-editor';
import { WorkflowAssignmentFields } from './workflow-assignment-fields';
import { WorkflowEmailOverride } from './workflow-email-override';
import { WorkflowTaskAssociations } from './workflow-task-associations';
import { workflowTemplateBinding, workflowTemplateDescriptor, workflowTemplateStageChoices, type WorkflowTemplateBindingPatch } from '../services/workflow-template-bindings';
import { Textarea } from '@/shared/components/ui/textarea';
export const workflowControl = cn(textFieldClassName, 'min-w-0 rounded-lg p-2');
export const emptyOptions: WorkflowOptions = {
  users: [],
  pipelines: [],
  templates: [],
  campaigns: [],
};
export const referenceOptions = references;

export function WorkflowTemplateFields({ draft, templateIndex, templateIdentity, options, onChange, onDetach }: {
  draft: WorkflowDraft; templateIndex?: number; templateIdentity?: number | string; options: WorkflowOptions;
  onChange: (patch: WorkflowTemplateBindingPatch) => void; onDetach: () => void;
}) {
  const localPipelineId = options.pipelines.find(pipeline => pipeline.name.trim().toLowerCase() === 'sales pipeline')?.id ?? (options.pipelines.length === 1 ? options.pipelines[0].id : '');
  const identity = templateIdentity ?? templateIndex;
  const descriptor = workflowTemplateDescriptor(identity);
  const binding = workflowTemplateBinding(draft, identity, options, localPipelineId);
  const routing = descriptor?.setup === 'pipeline-routing' || descriptor?.setup === 'related-deal-routing';
  const stages = workflowTemplateStageChoices(options, binding.pipelineId, routing || ['qualified-entry', 'open-entry', 'initial-entry'].includes(descriptor?.setup ?? ''));
  const stageSelect = (role: 'sourceStageId' | 'targetStageId', label: string) => {
    const choices = stages.filter(stage => descriptor?.setup === 'won-entry' ? stage.isWon && !stage.isLost
      : descriptor?.setup === 'lost-entry' ? stage.isLost && !stage.isWon
      : descriptor?.setup === 'initial-entry' ? stage.name.trim().toLowerCase() === 'lead'
      : descriptor?.setup === 'reopen-entry' ? role === 'sourceStageId' ? stage.isLost && !stage.isWon : !stage.isWon && !stage.isLost && stage.name.trim().toLowerCase() === 'qualified' : true);
    return <label className="block space-y-1">
    {label}
    <select aria-label={label} aria-required="true" className={workflowControl} value={binding[role]} disabled={!binding.pipelineId} onChange={event => onChange({ pipelineId: binding.pipelineId, [role]: event.target.value })}>
      <option value="">Choose a stage</option>
      {binding[role] && !choices.some(stage => stage.id === binding[role]) && <option value={binding[role]}>Unavailable selection — repair required</option>}
      {choices.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
    </select>
  </label>;
  };
  return <fieldset className="space-y-3 rounded-xl border border-[var(--border)] p-3 text-sm">
    <legend className="px-1 font-semibold">Template stage setup</legend>
    <p className="text-xs text-[var(--muted-foreground)]">{routing ? 'Choose different open stages in the same pipeline.' : descriptor?.setup === 'initial-entry' ? 'Runs when a Deal is created in this pipeline’s open Lead stage.' : descriptor?.setup === 'reopen-entry' ? 'Only never-Won Deals with verified history can reopen from Lost to an open Qualified stage.' : descriptor?.setup === 'won-entry' || descriptor?.setup === 'lost-entry' ? 'Creates a task after the Deal closes in this stage.' : 'Creates a task per matching stage entry. Outdated entries are skipped.'}</p>
    <div className="space-y-1"><p className="text-xs text-muted-foreground">Pipeline</p><p>{options.pipelines.find(pipeline => pipeline.id === binding.pipelineId)?.name ?? 'Sales Pipeline unavailable'}</p></div>
    {(routing || descriptor?.setup === 'reopen-entry') && stageSelect('sourceStageId', 'Template source stage')}
    {stageSelect('targetStageId', routing ? 'Template target stage' : 'Template entry stage')}
    {descriptor?.setup === 'related-deal-routing' && <p className="text-xs text-[var(--muted-foreground)]">Moves one matching Deal by default. Refine filters or choose All matching.</p>}
    {!!stages.find(stage => stage.id === binding.targetStageId)?.requiredFields?.length && <p className="text-xs text-[var(--muted-foreground)]">Stage requirements: {stages.find(stage => stage.id === binding.targetStageId)!.requiredFields!.join(', ')}.</p>}
    <Button type="button" variant="link" className="h-auto px-0 text-xs" onClick={onDetach}>Customize without linked template setup</Button>
  </fieldset>;
}

function UpdateFieldFields({ action, options, entity, onChange }: {
  action: WorkflowAction; options: WorkflowOptions; entity?: WorkflowEntity;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const fields = entity ? getWorkflowUpdateFields(entity, options.customFields, options.fieldLayouts?.[WORKFLOW_MODULES[entity]]) : [];
  const field = fields.find((entry) => entry.field === action.config.field);
  const [group, setGroup] = useState<'standard' | 'custom'>(field?.group === 'custom' ? 'custom' : 'standard');
  const selectedGroup = field?.group ?? group;
  const value = action.config.value;
  const errorId = useId();
  const fieldKey = field?.customFieldId ? undefined : field?.field;
  const valueSchema = workflowRecordTextSchema(entity, fieldKey);
  const valueError = typeof value === 'string' && valueSchema && !action.config.clear && value
    ? textFieldError(valueSchema, value) : undefined;

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
          : choices ? <select aria-label="New value" className={workflowControl} value={String(value ?? '')} onChange={(event) => change({ value: event.target.value })}><option value="">Select {field.label.toLowerCase()}</option>{value && !choices.some(choice => choice.id === value) ? <option value={String(value)}>Unavailable selection</option> : null}{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select>
            : field.type === 'list' ? <Textarea aria-label="New value" className={workflowControl} rows={4} placeholder="One value per line" value={Array.isArray(value) ? value.join('\n') : ''} onChange={(event) => change({ value: event.target.value.split('\n') })} />
            : ['number', 'date'].includes(field.type) ? <Input aria-label="New value" type={field.type === 'number' ? 'number' : 'date'} step="any" placeholder={field.type === 'number' ? 'Enter a number...' : undefined} value={String(value ?? '')} onChange={(event) => change({ value: field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value })} />
              : <Textarea aria-label="New value" className={workflowControl} rows={field.multiline ? 4 : 2} placeholder={`Enter ${field.label.toLowerCase()}...`} aria-invalid={!!valueError} aria-describedby={valueError ? errorId : undefined} maxLength={valueSchema ? undefined : field.maxLength ?? 1000} value={String(value ?? '')} onChange={(event) => change({ value: event.target.value })} />}
      </label>}
      {valueError && <p role="alert" id={errorId} className="text-xs text-destructive">{valueError}</p>}
      {entity !== 'lead' && othersSelected && <label className="block space-y-1">Specify (optional)<Input aria-label="Specify (optional)" placeholder="Enter additional details..." maxLength={1000} value={String(action.config.otherDetails ?? '')} onChange={(event) => change({ otherDetails: event.target.value })} /><span className="block text-xs text-[var(--muted-foreground)]">Others counts as a selected interest even without additional details.</span></label>}
      {field.type === 'stage' && <label className="block space-y-1">Lost reason (for a lost stage)<Input aria-label="Lost reason" placeholder="Enter the loss reason..." value={String(action.config.lostReason ?? '')} onChange={(event) => change({ lostReason: event.target.value })} /></label>}
    </div>}
  </div>;
}
export function ConditionFields({
  value,
  trigger,
  options,
  onChange,
  previousConditions,
}: {
  value: WorkflowCondition;
  trigger?: TriggerDefinition;
  options: WorkflowOptions;
  onChange: (value: WorkflowCondition) => void;
  previousConditions?: WorkflowCondition | null;
}) {
  const id = useId();
  const missingValues = missingWorkflowConditionValues(value, previousConditions);
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
        const operators = field ? workflowOperators(field.type) : [];
        const supported = !!field && operators.includes(rule.operator);
        const issue = conditionRuleIssue(rule, trigger, options) || (missingValues.includes(index) ? 'Enter a value or choose an empty-value operator.' : '');
        const issueId = `${id}-condition-${index}-error`;
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
              <ConditionFieldSelect required label={`Condition ${index + 1} field`} aria-required="true" aria-invalid={!field} aria-describedby={issue ? issueId : undefined} className={workflowControl} value={rule.field} fields={(trigger?.fields ?? []).map(field => ({ key: field.field, label: field.label, group: field.group === 'custom' ? 'Custom Fields' : 'Standard Fields' }))} onChange={key => {
                const next = trigger?.fields.find(field => field.field === key);
                const changed = transitionConditionField(rule, next && { key: next.field, type: next.type }, next ? workflowOperators(next.type) : [], 'workflow');
                update({ ...changed, operator: (changed.operator || 'equals') as typeof rule.operator, incompleteValue: undefined });
              }} />
            </label>
            <label className="block">
              Operator
              <ConditionOperatorSelect label={`Condition ${index + 1} operator`} aria-invalid={!!field && !supported} aria-describedby={issue ? issueId : undefined} disabled={!field} className={workflowControl} value={rule.operator} operators={operators.map(key => ({ key, label: conditionOperatorLabel(key, 'dropdown', field?.type === 'date' ? 'date' : undefined) }))} onChange={operator => update({ ...transitionConditionOperator(rule, operator, field?.type, 'workflow'), operator: operator as typeof rule.operator, incompleteValue: undefined })} />
            </label>
            {conditionOperatorValueShape(rule.operator) !== 'none' && (
              <label className="block">
                <span>Value <span className="text-red-500" aria-hidden="true">*</span></span>
                {field?.type === 'boolean' ? (
                  <select
                    className={workflowControl}
                    aria-label={`Condition ${index + 1} value`}
                    aria-required="true"
                    aria-invalid={!!issue}
                    aria-describedby={issue ? issueId : undefined}
                    disabled={!supported}
                    value={typeof rule.value === 'boolean' ? String(rule.value) : ''}
                    onChange={(event) =>
                      update({ value: event.target.value === '' ? '' : event.target.value === 'true' })
                    }
                  >
                    <option value="">Select yes or no</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : choices ? (
                  <select
                    aria-label={`Condition ${index + 1} value`}
                    aria-required="true"
                    aria-invalid={!!issue}
                    aria-describedby={issue ? issueId : undefined}
                    disabled={!supported}
                    className={workflowControl}
                    value={String(rule.value ?? '')}
                    onChange={(event) => update({ value: event.target.value })}
                  >
                    <option value="">Select {field?.label.toLowerCase() ?? 'a value'}</option>
                    {rule.value && !choices.some(choice => choice.id === rule.value) ? <option value={String(rule.value)}>Unavailable selection</option> : null}
                    {choices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.name}
                      </option>
                    ))}
                  </select>
                ) : field?.multiline ? <Textarea aria-label={`Condition ${index + 1} value`} aria-required="true" aria-invalid={!!issue} aria-describedby={issue ? issueId : undefined} disabled={!supported} className={workflowControl} rows={4} placeholder={`Enter ${field.label.toLowerCase()}...`} maxLength={field.maxLength} value={String(rule.value ?? '')} onChange={event => update({ value: event.target.value })} /> : (
                  <ConditionScalarInput placeholder={field?.type === 'date' ? undefined : field?.type === 'number' ? 'Enter a number...' : field ? `Enter ${field.label.toLowerCase()}...` : 'Choose a field first'} aria-label={`Condition ${index + 1} value`} aria-required="true" aria-invalid={!!issue} aria-describedby={issue ? issueId : undefined} disabled={!supported} className={workflowControl} type={!field ? typeof rule.value === 'number' ? 'number' : 'text' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} maxLength={field?.maxLength ?? 1000} value={rule.value} onValueChange={value => update({ value })} />
                )}
              </label>
            )}
            {issue && <p id={issueId} role="status" className="text-sm text-destructive">{issue}</p>}
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
              newWorkflowCondition(trigger?.fields[0]),
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
  stageSetup,
  previous,
}: {
  action: WorkflowAction;
  definition?: ActionDefinition;
  options: WorkflowOptions;
  entity?: WorkflowEntity;
  onChange: (config: Record<string, unknown>) => void;
  stageSetup?: ReactNode;
  previous?: WorkflowAction;
}) {
  const actionFieldId = useId();
  const savedPipeline = options.pipelines.find(entry => entry.stages.some(stage => stage.id === action.config.stageId));
  const defaultPipeline = options.pipelines.find(entry => entry.name.trim().toLowerCase() === 'sales pipeline') ?? (options.pipelines.length === 1 ? options.pipelines[0] : undefined);
  const selectedPipeline = (savedPipeline ?? defaultPipeline)?.id;
  if (retiredActionLabels[action.type]) return <p role="status" className="rounded-lg border border-amber-300 p-3 text-sm">{action.type === 'create_notification' ? 'Notifications are automatic.' : 'Send Campaign is no longer available in workflows.'} This saved step is preserved. Disable or remove it before activating the workflow.</p>;
  if (action.type === 'update_field') return <UpdateFieldFields action={action} options={options} entity={entity} onChange={onChange} />;
  return (
    <div className="space-y-4 text-sm">
      {['create_task', 'assign_owner'].includes(action.type) && <WorkflowAssignmentFields action={action} entity={entity} options={options} className={workflowControl} onChange={onChange} />}
      {action.type === 'create_task' && <WorkflowTaskAssociations action={action} entity={entity} options={options} onChange={onChange} />}
      {action.type === 'send_email' && <p className="text-xs text-muted-foreground">Sends through the record agent’s Gmail.</p>}
      {action.type === 'move_deal_stage' && stageSetup}
      {action.type === 'move_deal_stage' && !stageSetup && <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Pipeline</p>
        <p>{(savedPipeline ?? defaultPipeline)?.name ?? 'Sales Pipeline unavailable'}</p>
        <p className="text-xs text-muted-foreground">The Deal must meet this stage’s entry requirements.</p>
      </div>}
      {Object.entries(definition?.configSchema ?? {}).map(([key, field]) => {
        if (action.type === 'move_deal_stage' && ['includeLossReason', 'lostReason'].includes(key)) return null;
        if (action.type === 'create_task' && ['targetMode', 'pipelineId', 'currentStageId', 'productInterestId', 'dealId'].includes(key)) return null;
        if (action.type === 'send_email' && (key === 'subject' || key === 'body') || action.type === 'send_sms' && key === 'message') return <WorkflowEmailOverride key={`${key}:${action.config.recipient ?? 'record'}`} field={key as 'subject' | 'body' | 'message'} label={field.label} value={String(action.config[key] ?? '')} entity={entity ? workflowMessageEntity(entity, action.config.recipient) : undefined} options={options} className={workflowControl} onChange={value => onChange({ ...action.config, [key]: value })} />;
        if (action.type === 'move_deal_stage' && stageSetup && ['stageId', 'currentStageId'].includes(key)) return null;
        if (field.type === 'assignment' || (action.type === 'create_task' && key === 'assignedUserId') || (action.type === 'assign_owner' && key === 'userId')) return null;
        if (action.type === 'move_deal_stage' && entity === 'deal' && ['targetMode', 'productInterestId', 'currentStageId'].includes(key)) return null;
        let choices = references(field.type, options) ??
          field.options?.map((option) => ({ id: option, name: option }));
        if (['stageId', 'currentStageId'].includes(key))
          choices =
            options.pipelines.find((entry) => entry.id === selectedPipeline)
              ?.stages ?? [];
        if (['send_sms', 'send_email'].includes(action.type) && key === 'recipient') choices = (choices ?? []).filter((choice) => entity === 'deal' ? choice.id !== 'record' : entity === 'account' ? choice.id === 'primary_contact' : choice.id === 'record').map((choice) => ({ ...choice, name: choice.id === 'record' ? 'Triggering record' : choice.id === 'primary_contact' ? 'Primary contact' : 'Primary lead' }));
        if (key === 'targetMode') choices = [{ id: 'single_match', name: 'One matching Deal (default)' }, { id: 'all_matching', name: 'All matching related Deals' }];
        const change = (value: unknown) =>
          onChange({ ...action.config, [key]: value });
        const value = String(action.config[key] ?? '');
        const taskText = action.type === 'create_task' && (key === 'title' || key === 'description');
        const taskError = taskText ? workflowTaskTextError(key, value, previous) : undefined;
        const errorId = actionFieldId + '-' + key + '-error';
        const placeholder = ({ title: 'Enter task title...', description: 'Describe the task...', dueDaysFromNow: 'Default: 3 days', lostReason: 'Enter the loss reason...', otherDetails: 'Enter additional details...' } as Record<string, string>)[key] ?? `Enter ${field.label.toLowerCase()}...`;
        const selectionPrompt = ({ templateId: 'Select an email template (optional)', recipient: field.required ? 'Select a recipient' : 'Use default recipient', priority: 'Default: Medium', targetMode: 'One matching Deal (default)', currentStageId: 'All current stages', productInterestId: 'All products' } as Record<string, string>)[key] ?? `Select ${field.label.toLowerCase()}`;
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
                      : selectionPrompt}
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
                <Textarea
                  aria-label={field.label}
                  aria-invalid={!!taskError}
                  aria-describedby={taskError ? errorId : undefined}
                  placeholder={placeholder}
                  className={workflowControl}
                  rows={4}
                  maxLength={taskText ? undefined : 10000}
                  value={value}
                  onChange={(event) => change(event.target.value)}
                />
              ) : (
                <Input
                  aria-label={field.label}
                  aria-invalid={!!taskError}
                  aria-describedby={taskError ? errorId : undefined}
                  placeholder={placeholder}
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
              {taskError && <p id={errorId} role="alert" className="text-xs text-destructive">{taskError}</p>}
            </label>
            {choices?.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {key === 'templateId' ? 'No email templates available.' : 'No options available.'}
              </p>
            )}
            {key === 'dueDaysFromNow' && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Use 0 for execution time. Each day adds 24 hours; dates display in Asia/Manila.
              </p>
            )}
            {variable && (
              <div
                className="flex flex-wrap gap-1"
                aria-label={`Personalize ${field.label}`}
              >
                {(entity ? getWorkflowMessageVariables(workflowMessageEntity(entity, action.type === 'send_sms' ? action.config.recipient : undefined), options.fieldLayouts?.[WORKFLOW_MODULES[workflowMessageEntity(entity, action.type === 'send_sms' ? action.config.recipient : undefined)]], options.customFields) : []).map(({ token, label }) => (
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
