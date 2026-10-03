'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Building2, CheckCheck, GitBranch, Info, Loader2, Plus, Search, ShieldCheck, UserPlus, Users, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { ActionDefinition, TriggerDefinition, WorkflowEntity } from '@leadcrm/shared';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/components/ui/dialog';
import { WORKFLOW_RECIPES } from '../services/workflow-recipes';
import { actionSummary, workflowActionLabel } from '../services/workflow-editor';
import { templateAvailability, templateConditionLabel, templateSetup, workflowRecordLabels } from '../services/workflow-template-catalog';
import { emptyOptions, workflowControl } from './workflow-fields';

interface Props {
  triggers: TriggerDefinition[];
  actions: ActionDefinition[];
  onClose: () => void;
  onChoose: (templateIndex?: number) => void | Promise<void>;
}
const recordIcons = { lead: UserPlus, contact: Users, deal: BriefcaseBusiness, account: Building2 };
const focusable = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]';

export function WorkflowCreateDialog({ triggers, actions, onClose, onChoose }: Props) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [record, setRecord] = useState('all');
  const [action, setAction] = useState('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const previousTemplate = useRef<number | null>(null);
  const mounted = useRef(true);
  const close = useCallback(() => { if (!lock.current) onClose(); }, [onClose]);
  const attachPanel = useCallback((node: HTMLDivElement | null) => {
    panel.current = node;
    if (node) {
      // Strict Mode can attach this ref again after focus is already inside the dialog.
      previousFocus.current ??= document.activeElement as HTMLElement;
      node.querySelector<HTMLInputElement>('input')?.focus();
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const containFocus = (event: FocusEvent) => {
      if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) {
        panel.current.querySelector<HTMLElement>(focusable)?.focus();
      }
    };
    document.addEventListener('focusin', containFocus);
    return () => {
      mounted.current = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('focusin', containFocus);
      previousFocus.current?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    if (selected !== null) {
      content.current?.scrollTo?.({ top: 0 });
      panel.current?.querySelector<HTMLButtonElement>('[data-template-back]')?.focus();
    } else if (previousTemplate.current !== null) {
      panel.current?.querySelector<HTMLButtonElement>(`[data-template-index="${previousTemplate.current}"]`)?.focus();
    }
    previousTemplate.current = selected;
  }, [selected]);

  const catalog = useMemo(() => WORKFLOW_RECIPES.map((recipe, index) => {
    const trigger = triggers.find(entry => entry.type === recipe.trigger);
    return { recipe, index, trigger, issues: templateAvailability(recipe, triggers, actions) };
  }), [triggers, actions]);
  const records = [...new Set(catalog.flatMap(entry => entry.trigger ? [entry.trigger.entity] : []))];
  const query = search.trim().toLowerCase();
  const filtered = catalog.filter(({ recipe, trigger }) =>
    (record === 'all' || trigger?.entity === record) &&
    (action === 'all' || recipe.actions.some(entry => entry.type === action)) &&
    `${recipe.name} ${recipe.description ?? ''} ${trigger?.label ?? ''} ${recipe.actions.map(entry => workflowActionLabel(entry.type)).join(' ')}`.toLowerCase().includes(query),
  );
  const current = selected === null ? undefined : catalog[selected];
  const hasFilters = !!search || record !== 'all' || action !== 'all';
  const clear = () => { setSearch(''); setRecord('all'); setAction('all'); searchInput.current?.focus(); };

  async function choose(index?: number) {
    if (lock.current || (index !== undefined && catalog[index]?.issues.length)) return;
    lock.current = true; setOpening(true); setError('');
    try { await onChoose(index); }
    catch (failure) {
      if (mounted.current) {
        const message = failure instanceof Error ? failure.message : 'Unable to open the workflow builder. Try again.';
        setError(message); toast.error(message);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setOpening(false);
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent ref={attachPanel} showClose={false} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      className="flex max-h-[calc(100dvh-2rem)] max-w-[960px] flex-col gap-0 overflow-hidden p-0 text-[var(--text-primary)] [color-scheme:light] dark:[color-scheme:dark]"
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(focusable));
        const first = elements[0], last = elements[elements.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-5 sm:px-6">
        <div className="min-w-0"><DialogTitle id={`${id}-title`} className="text-xl leading-snug">Create workflow</DialogTitle>
          <DialogDescription id={`${id}-description`} className="mt-1.5 leading-relaxed">Start from scratch or customize a ready-made workflow.</DialogDescription></div>
        <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Close create workflow" disabled={opening} onClick={close}><X aria-hidden="true" /></Button>
      </header>
      <div ref={content} className="min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        {current ? <div className="space-y-5">
          <Button type="button" variant="ghost" className="-ml-2 min-h-11" data-template-back disabled={opening} onClick={() => { setSelected(null); setError(''); }}><ArrowLeft aria-hidden="true" />All templates</Button>
          <div><p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">{current.trigger ? workflowRecordLabels[current.trigger.entity] : 'Template'}</p><h3 className="text-lg font-semibold">{current.recipe.name}</h3><p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">{current.recipe.description}</p></div>
          {!!current.issues.length && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{current.issues.join(' ')} Refresh workflow options before trying again.</div>}
          <ol aria-label="Template steps" className="space-y-3">
            <li className="flex gap-3 rounded-xl border border-[var(--border)] p-4"><Zap size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--primary)]" /><div><h4 className="text-sm font-semibold">Trigger</h4><p className="mt-1 text-sm text-[var(--muted-foreground)]">{current.trigger?.label ?? current.recipe.trigger}</p></div></li>
            {!!current.recipe.conditions?.conditions.length && <li className="flex gap-3 rounded-xl border border-[var(--border)] p-4"><GitBranch size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--primary)]" /><div className="min-w-0"><h4 className="text-sm font-semibold">{current.recipe.conditions.operator === 'AND' ? 'Match all conditions' : 'Match any condition'}</h4><ul className="mt-2 space-y-1 text-sm leading-relaxed text-[var(--muted-foreground)]">{current.recipe.conditions.conditions.map((rule, index) => <li key={index}>{templateConditionLabel(rule, current.trigger)}</li>)}</ul></div></li>}
            {current.recipe.actions.map((step, index) => <li key={index} className="flex gap-3 rounded-xl border border-[var(--border)] p-4"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--primary)]/10 text-xs font-semibold text-[var(--primary)]">{index + 1}</span><div className="min-w-0"><h4 className="text-sm font-semibold">{workflowActionLabel(step.type)}</h4><ul className="mt-1 space-y-1 break-words text-sm leading-relaxed text-[var(--muted-foreground)]">{actionSummary(step, emptyOptions).map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}</ul></div></li>)}
          </ol>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--primary)]/5 p-4" aria-label="Template setup requirements"><h4 className="flex items-center gap-2 text-sm font-semibold"><Info size={16} aria-hidden="true" />Before you activate</h4><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted-foreground)]">{templateSetup(current.recipe, current.trigger, actions).map(note => <li key={note}>{note}</li>)}<li>Review the workflow name and configuration. The builder validates workspace references, permissions, and connected services when you save or activate.</li></ul></section>
        </div> : <div>
          <div className="mb-6 flex flex-col items-start justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--primary)]/5 p-4 sm:flex-row sm:items-center sm:p-5">
            <div><h3 className="text-base font-semibold">Build your own workflow</h3><p className="mt-1 text-sm leading-relaxed text-[var(--muted-foreground)]">Choose a trigger, add conditions, and set your actions.</p></div>
            <Button type="button" className="min-h-11 w-full shrink-0 sm:w-auto" disabled={opening} onClick={() => void choose()}><Plus aria-hidden="true" />Start from scratch</Button>
          </div>
          <h3 className="mb-4 text-base font-semibold">Explore templates</h3>
          <div className="relative mb-3"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted-foreground)]" /><Input ref={searchInput} type="search" aria-label="Search templates" placeholder="Search templates…" value={search} onChange={event => setSearch(event.target.value)} className="h-11 pl-10 text-base sm:text-sm" /></div>
          <div className="grid grid-cols-1 gap-3 min-[541px]:grid-cols-2">
            <label className="space-y-1.5 text-xs font-semibold">Record type<select value={record} onChange={event => setRecord(event.target.value)} className={`${workflowControl} min-h-11 text-base font-normal sm:text-sm`}><option value="all">All records</option>{records.map(entity => <option key={entity} value={entity}>{workflowRecordLabels[entity]}</option>)}</select></label>
            <label className="space-y-1.5 text-xs font-semibold">Action<select value={action} onChange={event => setAction(event.target.value)} className={`${workflowControl} min-h-11 text-base font-normal sm:text-sm`}><option value="all">All actions</option>{actions.map(definition => <option key={definition.type} value={definition.type}>{definition.label}</option>)}</select></label>
          </div>
          <div className="my-3 flex min-h-11 items-center justify-between gap-3"><p role="status" aria-live="polite" className="text-xs text-[var(--muted-foreground)]">{filtered.length} {filtered.length === 1 ? 'template' : 'templates'}{hasFilters ? ` of ${catalog.length}` : ' available'}</p>{hasFilters && <Button type="button" variant="ghost" className="min-h-11 text-[var(--primary)]" onClick={clear}>Clear filters</Button>}</div>
          <div className="grid grid-cols-1 gap-3 min-[541px]:grid-cols-2 lg:grid-cols-3" aria-label="Workflow templates">
            {filtered.map(({ recipe, index, trigger, issues }) => {
              const Icon = recordIcons[trigger?.entity as WorkflowEntity] ?? CheckCheck;
              return <button type="button" key={index} data-template-index={index} aria-label={`Preview ${recipe.name}`} disabled={opening} onClick={() => { setSelected(index); setError(''); }}
                className="group flex min-w-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-left transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:opacity-50 motion-reduce:transition-none">
                <span className="mb-3 flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><Icon size={16} aria-hidden="true" className="text-[var(--primary)]" />{trigger ? workflowRecordLabels[trigger.entity] : 'Template'}</span>
                <span className="text-sm font-semibold leading-relaxed">{recipe.name}</span><span className="mb-4 mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--muted-foreground)]">{recipe.description}</span>
                <span className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-xs"><span className="text-[var(--muted-foreground)]">{issues.length ? 'Unavailable' : `${recipe.actions.length} ${recipe.actions.length === 1 ? 'action' : 'actions'}`}</span><span className="flex items-center gap-1 font-semibold text-[var(--primary)]">Preview<ArrowRight size={14} aria-hidden="true" /></span></span>
              </button>;
            })}
          </div>
          {!filtered.length && <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center"><h4 className="text-sm font-semibold">No matching templates</h4><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">{action === 'send_sms' && !catalog.some(entry => entry.recipe.actions.some(step => step.type === 'send_sms')) ? 'No SMS templates are included yet. Start from scratch to add a Send SMS action.' : 'Try another search or clear your filters.'}</p><Button type="button" variant="link" className="mt-2 min-h-11" onClick={clear}>Reset template filters</Button></div>}
        </div>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--muted)]/40 px-4 py-4 sm:px-6">
        <p role={opening ? 'status' : undefined} className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">{opening ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <ShieldCheck size={16} aria-hidden="true" className="shrink-0" />}{opening ? 'Opening builder…' : 'Review and configure before activating.'}</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={opening} onClick={close}>Cancel</Button>{current && <Button type="button" className="min-h-11" disabled={opening || !!current.issues.length} onClick={() => void choose(current.index)}>Use this template<ArrowRight aria-hidden="true" /></Button>}</div>
      </footer>
    </DialogContent>
  </Dialog>;
}
