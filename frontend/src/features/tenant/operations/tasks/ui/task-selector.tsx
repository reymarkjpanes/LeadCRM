"use client";
import { ChevronDown, Search, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { TaskOption, TaskOptionKind } from "@leadcrm/shared";
import { useData } from "@/store/DataContext";
import { getAssignableAgents } from "@/shared/utils/assigned-agents";
import { useAuth } from "@/store/AuthContext";
import { tasksApi } from "@/shared/services/tasks.api";
import { USE_MOCK_DATA } from "@/lib/config";
import { Button } from "@/shared/components/ui/button";
import { panelInputClass, panelLabelClass } from "@/shared/components/side-panel-styles";
export const taskInputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
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
  } = props;
  const inputClass = appearance === "panel" ? panelInputClass : taskInputClass;
  const selectedIds = Array.isArray(value) ? value : value ? [value] : [];
  const leadKey = JSON.stringify(leadIds);
  const id = useId();
  const { users, contacts, deals, organizations } = useData();
  const { user, tenant } = useAuth();
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<TaskOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
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
    if (!open) return;
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds)
      setAbove(bounds.bottom > window.innerHeight - 360 && bounds.top > 340);
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoading(true);
    setOptions([]);
    setError("");
    const timer = setTimeout(async () => {
      try {
        let rows: TaskOption[];
        if (USE_MOCK_DATA) {
          rows =
            kind === "user"
              ? getAssignableAgents(users)
                  .filter((u) => u.status.toLowerCase() === "active")
                  .map((u) => ({
                    id: u.id,
                    label: u.firstName + " " + u.lastName,
                  }))
              : kind === "deal"
                ? deals
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
              row.label.toLowerCase().includes(search.toLowerCase()),
            )
            .slice(0, 50);
        } else
          rows = (
            await (leadIds.length
              ? tasksApi.options(kind, search, abort.signal, leadIds)
              : tasksApi.options(kind, search, abort.signal))
          ).data;
        if (!abort.signal.aborted) setOptions(rows);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load options.");
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [
    open,
    kind,
    search,
    retry,
    leadKey,
    tenant?.id,
    users,
    contacts,
    deals,
    organizations,
  ]);
  const labelFor = (id: string) =>
    options.find((option) => option.id === id)?.label ||
    selected[id] ||
    selectedLabels.find((option) => option.id === id)?.label ||
    (!props.multiple ? selectedLabel : undefined) ||
    "Selected record";
  const caption = selectedIds.length
    ? labelFor(selectedIds[0]) +
      (selectedIds.length > 1 ? ` +${selectedIds.length - 1}` : "")
    : "";
  const visible = !search
    ? [
        ...selectedIds
          .filter((id) => kind !== "user" && !options.some((option) => option.id === id))
          .map((id) => ({ id, label: labelFor(id) })),
        ...options,
      ]
    : options;
  const filteredByLeads =
    kind !== "lead" && kind !== "user" && leadIds.length > 0;
  return (
    <div
      ref={wrapper}
      className="relative space-y-2"
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
            (appearance === "panel" ? "min-w-0 [overflow-wrap:anywhere] " : "truncate ") + (selectedIds.length ? "" : "text-muted-foreground")
          }
        >
          {selectedIds.length
            ? caption
            : "Select " +
              (kind === "user" || kind === "account" ? "an " : "a ") +
              singular}
        </span>
        <ChevronDown size={16} className={"shrink-0 " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={"Select " + singular}
          className={
            "absolute left-0 right-0 z-30 overflow-hidden rounded-xl border border-border bg-background shadow-xl " +
            (appearance === "panel" ? "bg-white dark:bg-slate-900 " : "") +
            (above ? "bottom-full mb-1" : "top-full mt-1")
          }
        >
          <div className="relative border-b border-border p-3">
            <Search
              size={16}
              className="absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={input}
              aria-label={"Search " + singular}
              placeholder={"Search for " + singular}
              className={inputClass + " pl-9"}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-2" aria-busy={loading}>
            {loading ? (
              <p
                role="status"
                className="px-2 py-3 text-xs text-muted-foreground"
              >
                Loading…
              </p>
            ) : error ? (
              <div role="alert" className="p-2 text-xs text-destructive">
                {error}
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => setRetry((v) => v + 1)}
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
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
                        props.multiple &&
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
                {!visible.length && (
                  <p className="p-3 text-sm text-muted-foreground">
                    {filteredByLeads
                      ? `No related ${kind === "contact" ? "contacts" : kind === "deal" ? "deals" : "accounts"} for the selected leads.`
                      : "No matching records."}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border p-3">
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
            {props.multiple && selectedIds.length > 0 && (
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
              variant="ghost"
              size="sm"
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
