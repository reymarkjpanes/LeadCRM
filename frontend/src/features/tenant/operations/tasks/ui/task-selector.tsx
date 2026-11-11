"use client";
import { useHasPermission } from '@/shared/hooks/use-permissions';
import { cn } from '@/lib/utils';
import { useProductInterests } from '@/shared/hooks/use-product-interests';
import { ChevronDown, Search, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TaskOption, TaskOptionKind } from "@leadcrm/shared";
import { taskTeamUserIds } from '../task-relations';
import { useData } from "@/store/DataContext";
import { getAssignableAgents } from "@/shared/utils/assigned-agents";
import { matchesSearch } from "@/shared/utils/search";
import { useAuth } from "@/store/AuthContext";
import { tasksApi } from "@/shared/services/tasks.api";
import { USE_MOCK_DATA } from "@/lib/config";
import { Button } from "@/shared/components/ui/button";
import { panelInputClass, panelLabelClass } from "@/shared/components/side-panel-styles";
import { Input, textFieldClassName } from '@/shared/components/ui/input';
export const taskInputClass =
  cn(textFieldClassName, "w-full rounded-lg border px-3 py-2 text-sm");
type TaskSelectorProps = {
  kind: TaskOptionKind;
  label: string;
  selectedLabel?: string;
  selectedLabels?: TaskOption[];
  onCreate?: () => void;
  required?: boolean;
  disabled?: boolean;
  leadIds?: string[];
  appearance?: "panel";
  dropdownPlacement?: 'overlay' | 'inline';
  selfAssignmentOnly?: boolean;
} & (
  | { multiple: true; value: string[]; onChange: (value: string[]) => void }
  | { multiple?: false; value: string; onChange: (value: string) => void }
);
export function TaskSelector(props: TaskSelectorProps) {
  const {
    kind,
    label,
    value,
    selectedLabel,
    selectedLabels = [],
    onCreate,
    required = false,
    disabled = false,
    leadIds = [],
    appearance,
    dropdownPlacement = 'overlay',
    selfAssignmentOnly = false,
  } = props;
  const inputClass = appearance === "panel" ? panelInputClass : taskInputClass;
  const selectedIds = Array.isArray(value) ? value : value ? [value] : [];
  const leadKey = JSON.stringify(leadIds);
  const id = useId();
  const { users, contacts, deals, organizations } = useData();
  const { user, tenant } = useAuth();
  const groupAccess = useHasPermission('tasks.view_all');
  const assignGrant = useHasPermission('tasks.assign');
  const inTaskScope = (assignedUserId: string | null | undefined) => !!user && (user.role === 'Client Admin' ||
    !!assignedUserId && (groupAccess ? taskTeamUserIds(user, users) : [user.id]).includes(assignedUserId));
  const { products } = useProductInterests();
  const canAccounts = useHasPermission('accounts.view'), canProducts = useHasPermission('products.view');
  const [accountId, setAccountId] = useState(''), [category, setCategory] = useState(''), [productInterestId, setProductInterestId] = useState('');
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [hasMore, setHasMore] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const categories = [...new Set(products.map(product => product.category).filter((value): value is string => !!value))].sort();
  const selectionAbort = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const changed = () => { selectionAbort.current?.abort(); setOpen(false); setOptions([]); };
    window.addEventListener('leadcrm:groups-changed', changed);
    return () => window.removeEventListener('leadcrm:groups-changed', changed);
  }, []);
  const [above, setAbove] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSearch, setSelectedSearch] = useState("");
  const [selectedOpen, setSelectedOpen] = useState(false);
  const filters = { search, ...(accountId ? { accountId } : {}), ...(category ? { category } : {}), ...(productInterestId ? { productInterestId } : {}), ...(leadIds.length ? { leadIds: leadIds.join(',') } : {}) };

  useEffect(() => () => { selectionAbort.current?.abort(); }, [open, search, accountId, category, productInterestId, leadKey]);
  const [options, setOptions] = useState<TaskOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestPending = useRef(false);
  const availableList = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  const singular =
    kind === "contact"
      ? "contact"
      : kind === "account"
        ? "account"
        : kind === "user"
          ? "owner"
          : kind;
  useEffect(() => {
    if (kind !== 'deal') return;
    requestPending.current = true;
    setPage(1);
    setOptions([]);
    setTotal(0);
    setHasMore(false);
    setError("");
    if (availableList.current) availableList.current.scrollTop = 0;
  }, [open, kind, search, accountId, category, productInterestId, leadKey,
    tenant?.id, user?.id, user?.role, groupAccess, assignGrant, selfAssignmentOnly]);
  useEffect(() => {
    setSelectedOpen(false);
    setSelectedSearch("");
  }, [open]);
  const loadNextPage = useCallback(() => {
    if (kind !== 'deal' || !open || !hasMore || loading || requestPending.current || selectingAll || error) return;
    requestPending.current = true;
    setPage(previous => previous + 1);
  }, [kind, open, hasMore, loading, selectingAll, error]);
  useEffect(() => {
    const list = availableList.current;
    // A short page must not leave the next page unreachable without a scrollbar.
    if (list && list.clientHeight > 0 && list.scrollHeight <= list.clientHeight) loadNextPage();
  }, [options, loadNextPage]);
  useEffect(() => {
    if (!open) return;
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds && dropdownPlacement === 'overlay')
      setAbove(bounds.bottom > window.innerHeight - 360 && bounds.top > 340);
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, dropdownPlacement]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    requestPending.current = true;
    setLoading(true);
    if (kind !== 'deal' || page === 1) setOptions([]);
    setError("");
    const timer = setTimeout(async () => {
      try {
        let rows: TaskOption[];
        if (USE_MOCK_DATA) {
          rows =
            kind === "user"
              ? getAssignableAgents(users, ['tasks'])
                  .filter((u) => u.tenantId === tenant?.id && u.status.toLowerCase() === "active")
                  .filter(u => inTaskScope(u.id) && (assignGrant || u.id === user?.id))
                  .map((u) => ({
                    id: u.id,
                    label: u.firstName + " " + u.lastName,
                  }))
              : kind === "deal"
                ? deals
                    .filter(d => inTaskScope(d.assignedUserId))
                    .filter(
                      (d) =>
                        !leadIds.length ||
                        leadIds.includes(d.leadId ?? "") ||
                        d.leadIds?.some((id) => leadIds.includes(id)),
                    )
                    .map((d) => ({ id: d.id, label: d.title }))
                : kind === "account"
                  ? organizations
                      .filter(
                        (o) =>
                          !leadIds.length ||
                          contacts.some(
                            (c) =>
                              leadIds.includes(c.id) &&
                              (c.accountId ?? c.organizationId) === o.id,
                          ),
                      )
                      .map((o) => ({ id: o.id, label: o.name }))
                  : kind === "lead"
                    ? contacts.map((c) => ({
                        id: c.id,
                        label: c.firstName + " " + c.lastName,
                      }))
                    : [];
          rows = rows
            .filter((row) =>
              matchesSearch(search, row.label),
            )
            ;
          if (kind === 'deal') {
            rows = rows.filter(row => { const deal = deals.find(deal => deal.id === row.id); const product = products.find(product => product.id === deal?.productInterestId); return (!accountId || deal?.accountId === accountId || deal?.organizationId === accountId) && (!productInterestId || deal?.productInterestId === productInterestId) && (!category || (category === '__uncategorized' ? !product?.category : product?.category === category)); });
            setTotal(rows.length); setHasMore(page * 25 < rows.length); rows = rows.slice((page - 1) * 25, page * 25);
          } else rows = rows.slice(0, 50);
        } else if (kind === 'deal') {
          const result = await tasksApi.dealOptions({ ...filters, page }, abort.signal);
          rows = result.data;
          if (!abort.signal.aborted) { setTotal(result.meta.total); setHasMore(result.meta.hasMore); }
        } else
          rows = (
            await (leadIds.length
              ? tasksApi.options(kind, search, abort.signal, leadIds)
              : tasksApi.options(kind, search, abort.signal))
          ).data;
        if (!abort.signal.aborted) {
          if (kind === 'deal') {
            setOptions(previous => [...new Map([...(page > 1 ? previous : []), ...rows].map(row => [row.id, row])).values()]);
            setSelected(previous => ({ ...previous, ...Object.fromEntries(rows.map(row => [row.id, row.label])) }));
          } else setOptions(kind === 'user' && selfAssignmentOnly ? rows.filter(row => row.id === user?.id) : rows);
        }
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load options.");
      } finally {
        if (!abort.signal.aborted) {
          requestPending.current = false;
          setLoading(false);
        }
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
      requestPending.current = false;
    };
  }, [
    open,
    kind,
    search,
    retry,
    leadKey,
    accountId, category, productInterestId, page, USE_MOCK_DATA ? products : null,
    tenant?.id,
    user?.id,
    user?.role, groupAccess, assignGrant,
    selfAssignmentOnly,
    USE_MOCK_DATA ? users : null,
    USE_MOCK_DATA ? contacts : null,
    USE_MOCK_DATA ? deals : null,
    USE_MOCK_DATA ? organizations : null,
  ]);
  const labelFor = (id: string) =>
    selectedLabels.find((option) => option.id === id)?.label ||
    (!props.multiple && selectedIds[0] === id ? selectedLabel : undefined) ||
    options.find((option) => option.id === id)?.label ||
    selected[id] ||
    "Selected record";
  const caption = selectedIds.length
    ? labelFor(selectedIds[0]) +
      (selectedIds.length > 1 ? ` +${selectedIds.length - 1}` : "")
    : "";
  const visible = !search.trim()
    ? [
        ...selectedIds
          .filter((id) => kind !== "user" && kind !== "deal" && !options.some((option) => option.id === id))
          .map((id) => ({ id, label: labelFor(id) })),
        ...options,
      ]
    : options;
  const filteredByLeads =
    kind !== "lead" && kind !== "user" && leadIds.length > 0;
  const removeDeal = (dealId: string) => {
    if (props.multiple) props.onChange(selectedIds.filter(id => id !== dealId));
  };
  const errorNotice = error && <div role="alert" className="p-2 text-xs text-destructive">
    {error}
    <button type="button" className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>Retry</button>
  </div>;
  return (
    <div
      ref={wrapper}
      className="relative min-w-0 max-w-full space-y-2"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (event.key === "ArrowDown" && !open && !disabled) {
          event.preventDefault();
          setOpen(true);
        }
      }}
    >
      <label id={id + "-label"} className={appearance === "panel" ? panelLabelClass : "block text-sm font-medium"}>
        {label}
        {required ? <> {appearance === "panel" ? <span className="text-red-500">*</span> : "*"}</> : ""}
      </label>
      <button
        ref={trigger}
        disabled={disabled}
        type="button"
        aria-labelledby={id + "-label"}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((value) => !value);
          setSearch("");
        }}
        className={
          inputClass + " flex items-center justify-between gap-2 text-left"
        }
      >
        <span
          className={
            (appearance === "panel" ? "min-w-0 [overflow-wrap:anywhere] " : "truncate ") + (selectedIds.length ? " " : "text-muted-foreground")
          }
        >
          {selectedIds.length
            ? caption
            : kind === "user" ? "Select Agent..." : "Select " +
              (kind === "account" ? "an " : "a ") +
              singular}
        </span>
        <ChevronDown size={16} className={"shrink-0 " + (open ? "rotate-180" : " ")} />
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={"Select " + singular}
          className={
            "min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-background shadow-xl " +
            (appearance === "panel" ? "bg-white dark:bg-slate-900 " : " ") +
            (dropdownPlacement === 'inline' ? "relative" : "absolute left-0 right-0 z-30 " + (above ? "bottom-full mb-1" : "top-full mt-1"))
          }
        >
          <div className="relative border-b border-border p-3">
            <Search
              size={16}
              className="absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={input}
              aria-label={"Search " + singular}
              placeholder={"Search for " + singular}
              className={inputClass + " pl-9"}
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
          </div>
          {kind === 'deal' && <div className="space-y-2 border-b border-border p-3">
            {canAccounts && <TaskSelector kind="account" label="Account (Company)" value={accountId} disabled={selectingAll} onChange={value => { setAccountId(value); setPage(1); }} />}
            {canProducts && <><label className="block text-xs">Product category<select aria-label="Filter deals by category" className={inputClass} value={category} disabled={selectingAll} onChange={event => { setCategory(event.target.value); setProductInterestId(''); setPage(1); }}><option value="">All categories</option><option value="__uncategorized">Uncategorized</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="block text-xs">Product<select aria-label="Filter deals by product" className={inputClass} value={productInterestId} disabled={selectingAll} onChange={event => { setProductInterestId(event.target.value); setPage(1); }}><option value="">All products</option>{products.filter(product => !category || (category === '__uncategorized' ? !product.category : product.category === category)).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label></>}
            <p role="status" className="text-xs text-muted-foreground">{selectedIds.length} selected · {total} matching deals</p>
            {props.multiple && <Button type="button" size="sm" variant="outline" disabled={loading || selectingAll || total === 0} onClick={async () => {
              if (selectingAll) return;
              const abort = new AbortController(); selectionAbort.current = abort; setSelectingAll(true); setError('');
              try {
                const rows = USE_MOCK_DATA ? deals.filter(deal => (!accountId || (deal.accountId ?? deal.organizationId) === accountId) && (!leadIds.length || deal.leadIds?.some(id => leadIds.includes(id)) || leadIds.includes(deal.leadId ?? '')) && (!productInterestId || deal.productInterestId === productInterestId) && (!category || (category === '__uncategorized' ? !products.find(product => product.id === deal.productInterestId)?.category : products.find(product => product.id === deal.productInterestId)?.category === category)) && matchesSearch(search, deal.title)).map(deal => ({ id: deal.id, label: deal.title })) : (await tasksApi.dealOptions({ ...filters, selectAll: true }, abort.signal)).data;
                if (abort.signal.aborted) return;
                const combined = [...new Set([...selectedIds, ...rows.map(row => row.id)])];
                if (combined.length > 50 || rows.length > 50) throw new Error('More than 50 deals would be selected. Narrow your filters or deselect deals.');
                setSelected(previous => ({ ...previous, ...Object.fromEntries(rows.map(row => [row.id, row.label])) })); props.onChange(combined);
              } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to select matching deals.'); }
              finally { setSelectingAll(false); }
            }}>Select all matching deals</Button>}
            {total > 50 && <p className="text-xs text-muted-foreground">Narrow your filters to 50 or fewer deals to select all.</p>}
            {selectedIds.length > 0 && props.multiple && <section className="min-w-0 overflow-hidden rounded-lg border border-border" aria-label="Selected deals">
              <div className="flex flex-wrap items-center justify-between gap-x-2 bg-blue-50 px-2 py-1 dark:bg-blue-500/10">
                <button type="button" className="flex min-h-11 min-w-0 items-center gap-2 rounded-md text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={selectedOpen} aria-controls={`${id}-selected`} onClick={() => setSelectedOpen(previous => !previous)}>
                  <ChevronDown size={16} aria-hidden="true" className={cn('shrink-0', !selectedOpen && '-rotate-90')} />
                  <span>Selected deals ({selectedIds.length})</span>
                </button>
                <Button type="button" size="sm" variant="outline" disabled={selectingAll} className="ml-auto bg-card" onClick={() => { props.onChange([]); setSelectedSearch(''); }}>
                  <Trash2 aria-hidden="true" />Clear selection
                </Button>
              </div>
              <div id={`${id}-selected`} hidden={!selectedOpen} className="space-y-2 p-2">
                <div className="relative">
                  <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input aria-label="Search selected deals" placeholder="Search selected deals..." className={inputClass + ' pl-9'} value={selectedSearch} onChange={event => setSelectedSearch(event.target.value)} />
                </div>
                <ul className="max-h-60 space-y-2 overflow-y-auto overscroll-contain" aria-label="Selected deal rows">
                  {selectedIds.filter(dealId => matchesSearch(selectedSearch, labelFor(dealId))).map(dealId => <li key={dealId} className="flex min-w-0 items-center gap-1 rounded-lg border border-border bg-card px-2">
                    <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 text-sm">
                      <input type="checkbox" checked disabled={selectingAll} className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={() => removeDeal(dealId)} />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{labelFor(dealId)}</span>
                    </label>
                    <Button type="button" size="icon" variant="ghost" disabled={selectingAll} aria-label={`Remove ${labelFor(dealId)}`} className="h-11 w-11 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300 [&_svg]:size-5" onClick={() => removeDeal(dealId)}><Trash2 aria-hidden="true" /></Button>
                  </li>)}
                </ul>
                {!selectedIds.some(dealId => matchesSearch(selectedSearch, labelFor(dealId))) && <p role="status" className="px-2 py-3 text-xs text-muted-foreground">No selected deals match your search.</p>}
              </div>
            </section>}
          </div>}
          <div ref={availableList} className="max-h-48 overflow-y-auto overscroll-contain p-2" aria-busy={loading}
            role={kind === 'deal' ? 'region' : undefined} aria-label={kind === 'deal' ? 'Available deals' : undefined} tabIndex={kind === 'deal' ? 0 : undefined}
            onScroll={kind === 'deal' ? event => { const list = event.currentTarget; if (list.scrollHeight - list.scrollTop - list.clientHeight <= 32) loadNextPage(); } : undefined}>
            {loading && (kind !== 'deal' || !visible.length) ? (
              <p
                role="status"
                className="px-2 py-3 text-xs text-muted-foreground"
              >
                Loading…
              </p>
            ) : error && (kind !== 'deal' || !visible.length) ? (
              errorNotice
            ) : (
              <>
                {kind === "user" && !search.trim() && selectedIds.filter(id => !options.some(option => option.id === id)).map(id => (
                  <label key={id} className="flex items-start gap-3 rounded-lg px-2 py-3 text-sm text-muted-foreground">
                    <input type="checkbox" checked disabled className="mt-0.5 accent-primary" />
                    <span className="min-w-0 break-words">{labelFor(id)} (current assignment, read-only)</span>
                  </label>
                ))}
                {visible.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-3 text-sm hover:bg-secondary/50"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-primary"
                      checked={selectedIds.includes(option.id)}
                      disabled={
                        selectingAll || props.multiple &&
                        selectedIds.length >= 50 &&
                        !selectedIds.includes(option.id)
                      }
                      onChange={() => {
                        setSelected((previous) => ({
                          ...previous,
                          [option.id]: option.label,
                        }));
                        if (props.multiple)
                          props.onChange(
                            selectedIds.includes(option.id)
                              ? selectedIds.filter((id) => id !== option.id)
                              : [...selectedIds, option.id],
                          );
                        else
                          props.onChange(value === option.id ? "" : option.id);
                      }}
                    />
                    <span className="min-w-0 break-words">{option.label}</span>
                  </label>
                ))}
                {!visible.length && !loading && !error && (
                  <p className="p-3 text-sm text-muted-foreground">
                    {kind === "user" && !search.trim() ? "No eligible agents available." : filteredByLeads
                      ? `No related ${kind === "contact" ? "contacts" : kind === "deal" ? "deals" : "accounts"} for the selected leads.`
                      : "No matching records."}
                  </p>
                )}
                {kind === 'deal' && loading && <p role="status" className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>}
                {kind === 'deal' && errorNotice}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
            {onCreate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onCreate();
                }}
              >
                <Plus size={14} />
                Create {kind === "account" ? "an" : "a"} {singular}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {props.multiple
                  ? `${selectedIds.length} selected (up to 50)`
                  : `Select one ${singular}`}
              </span>
            )}
            {kind !== 'deal' && props.multiple && selectedIds.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => props.onChange([])}
              >
                Clear selection
              </Button>
            )}
            <Button
              type="button"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
