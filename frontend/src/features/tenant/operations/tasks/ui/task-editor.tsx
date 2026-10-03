"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  TASK_STATUSES,
  TASK_LINK_KINDS,
  taskAssociationIds,
  type TaskLinkInput,
  type TaskLinkKind,
  TASK_STATUS_LABELS,
  type TaskRecord,
  type TaskOption,
  type TaskOptionKind,
  type CreateTaskInput,
} from "@leadcrm/shared";
import { useData } from "@/store/DataContext";
import { useAuth } from "@/store/AuthContext";
import { useHasPermission } from "@/shared/hooks/use-permissions";
import { USE_MOCK_DATA } from "@/lib/config";
import { TaskRecordCreator } from "./task-record-creator";
import { Sheet, SheetContent } from "@/shared/components/ui/sheet";
import { Button } from "@/shared/components/ui/button";
import { localDateTime, taskDueInstant } from "../task-data";

export type TaskLinks = TaskLinkInput;
import { TaskSelector, taskInputClass } from "./task-selector";
export { TaskSelector, taskInputClass } from "./task-selector";

export function TaskEditor({
  task,
  links = {},
  readOnly = false,
  onClose,
}: {
  task?: TaskRecord;
  links?: TaskLinks;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { addTask, updateTask, deleteTask } = useData();
  const canCreate = useHasPermission("tasks.create"),
    canEdit = useHasPermission("tasks.edit"),
    canArchive = useHasPermission("tasks.archive");
  const canComplete = useHasPermission("tasks.complete"), canAssign = useHasPermission("tasks.assign");
  const canCreateContacts = useHasPermission("contacts.create"),
    canEditLeads = useHasPermission("leads.edit"),
    canCreateAccounts = useHasPermission("accounts.create");
  const canContacts = useHasPermission("leads.view"),
    canAccounts = useHasPermission("accounts.view");
  const editable = !readOnly && !task?.isArchived && (task ? canEdit : canCreate);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState(task?.status ?? "pending");
  const [priority, setPriority] = useState(task?.priority ?? "Medium");
  const [dueDate, setDueDate] = useState(
    localDateTime(
      task?.dueDate ?? new Date(Date.now() + 86400000).toISOString(),
    ),
  );
  const [assignedUserId, setOwner] = useState(
    task?.assignedUserId ?? user?.id ?? "",
  );
  const [relations, setRelations] = useState<Record<TaskLinkKind, string[]>>(
    () => ({
      lead: taskAssociationIds(task ?? links, "lead"),
      contact: taskAssociationIds(task ?? links, "contact"),
      deal: taskAssociationIds(task ?? links, "deal"),
      account: taskAssociationIds(task ?? links, "account"),
    }),
  );
  const [associationNotice, setAssociationNotice] = useState("");
  const changeRelations = (kind: TaskLinkKind, ids: string[]) => {
    if (kind === "lead") {
      setRelations({ lead: ids, contact: [], deal: [], account: [] });
      setAssociationNotice(
        "Lead selection changed. Choose related contacts, deals, and accounts again.",
      );
    } else setRelations((previous) => ({ ...previous, [kind]: ids }));
  };
  const [creating, setCreating] = useState<Exclude<
    TaskOptionKind,
    "user"
  > | null>(null);
  const [createdLabels, setCreatedLabels] = useState<
    Partial<Record<TaskLinkKind, TaskOption[]>>
  >({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmArchive, setConfirmArchive] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(
      () => panel.current?.querySelector<HTMLElement>("input,button")?.focus(),
      0,
    );
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ),
      ];
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !panel.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  const save = async () => {
    if (busy || !editable) return;
    setBusy(true);
    setError("");
    try {
      if (!title.trim()) throw new Error("Enter a task title.");
      if (!assignedUserId) throw new Error("Select a task owner.");
      const data = {
        title,
        description,
        status,
        priority,
        dueDate:
          task && dueDate === localDateTime(task.dueDate)
            ? task.dueDate
            : taskDueInstant(dueDate),
        assignedUserId,
        leadIds: relations.lead,
        contactIds: relations.contact,
        dealIds: relations.deal,
        accountIds: relations.account,
      };
      if (task) {
        const updates: Partial<TaskRecord> = { ...data };
        // Preserve untouched links, including historical archived relationships.
        if (assignedUserId === task.assignedUserId)
          delete updates.assignedUserId;
        for (const kind of TASK_LINK_KINDS) {
          if (
            JSON.stringify(relations[kind]) ===
            JSON.stringify(taskAssociationIds(task, kind))
          )
            delete updates[`${kind}Ids`];
        }
        await updateTask(task.id, updates);
      } else await addTask(data);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save task.");
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!task) return;
    setBusy(true);
    setError("");
    try {
      await deleteTask(task.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to archive task.");
    } finally {
      setBusy(false);
    }
  };
  const person =
    task?.assignedUser ?? (assignedUserId === user?.id ? user : undefined);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          if (creating) setCreating(null);
          else onClose();
        }
      }}
    >
      <SheetContent
        ref={panel}
        aria-labelledby={heading}
        showClose={!busy}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) {
              if (creating) setCreating(null);
              else onClose();
            }
          }
        }}
      >
        <header className="border-b border-border bg-primary/10 px-6 py-5 pr-14">
          <h2 id={heading} className="mt-1 text-xl font-semibold">
            {creating
              ? creating === "contact"
                ? "New Contact"
                : "Create " + creating
              : task
                ? "Task details"
                : "Create task"}
          </h2>
          {creating === "contact" && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Complete the contact details below.
            </p>
          )}
        </header>
        {creating ? (
          <TaskRecordCreator
            kind={creating}
            leadIds={relations.lead}
            onBusy={setBusy}
            onCancel={() => setCreating(null)}
            onCreated={(option) => {
              if (
                relations.lead.length &&
                (creating === "contact" || creating === "account")
              ) {
                setRelations((previous) => ({
                  ...previous,
                  account: creating === "account" ? [option.id] : [],
                  ...(creating === "contact"
                    ? { contact: [...previous.contact, option.id] }
                    : {}),
                }));
                setAssociationNotice(
                  "Lead relationship updated. Review the Task’s related Account selection before saving.",
                );
              } else
                changeRelations(creating, [...relations[creating], option.id]);
              setCreatedLabels((previous) => ({
                ...previous,
                [creating]: [...(previous[creating] ?? []), option],
              }));
              setCreating(null);
            }}
          />
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              <fieldset
                disabled={!editable || busy}
                className="space-y-5 disabled:opacity-75"
              >
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Title *</span>
                  <input
                    className={taskInputClass}
                    required
                    maxLength={255}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <label className="space-y-2">
                    <span className="text-sm font-medium">Status</span>
                    <select
                      className={taskInputClass}
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as typeof status)
                      }
                    >
                      {TASK_STATUSES.filter(value => value !== "completed" || canComplete || task?.status === "completed").map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium">Priority</span>
                    <select
                      className={taskInputClass}
                      value={priority}
                      onChange={(e) =>
                        setPriority(e.target.value as typeof priority)
                      }
                    >
                      {["Low", "Medium", "High"].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">
                    Due date and time *
                  </span>
                  <input
                    className={taskInputClass}
                    type="datetime-local"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                  <span className="block text-xs text-muted-foreground">
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </span>
                </label>
                <TaskSelector
                  kind="user"
                  disabled={!canAssign}
                  label="Assigned Agent"
                  required
                  value={assignedUserId}
                  selectedLabel={
                    person
                      ? person.firstName + " " + person.lastName
                      : undefined
                  }
                  onChange={setOwner}
                />
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Notes</span>
                  <textarea
                    rows={5}
                    maxLength={10000}
                    className={taskInputClass}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    {description.length}/10000
                  </span>
                </label>
                <section>
                  <h3 className="text-sm font-semibold text-primary">
                    Associate task (
                    {Object.values(relations).reduce(
                      (sum, ids) => sum + ids.length,
                      0,
                    )}
                    )
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Select multiple records. Contacts, deals, and accounts are
                    filtered by the selected leads.
                  </p>
                  {associationNotice && (
                    <p
                      role="status"
                      className="mt-2 text-xs text-muted-foreground"
                    >
                      {associationNotice}
                    </p>
                  )}
                  <div className="mt-4 space-y-4">
                    {(["lead", "contact", "deal", "account"] as const)
                      .filter(
                        (kind) =>
                          kind === "deal" ||
                          (kind === "account" ? canAccounts : canContacts),
                      )
                      .map((kind) => {
                        const options: TaskOption[] =
                          kind === "lead"
                            ? (
                                task?.leads ?? (task?.lead ? [task.lead] : [])
                              ).map((row) => ({
                                id: row.id,
                                label: row.firstName + " " + row.lastName,
                              }))
                            : kind === "contact"
                              ? (
                                  task?.contacts ??
                                  (task?.contact ? [task.contact] : [])
                                ).map((row) => ({
                                  id: row.id,
                                  label: row.firstName + " " + row.lastName,
                                }))
                              : kind === "deal"
                                ? (
                                    task?.deals ??
                                    (task?.deal ? [task.deal] : [])
                                  ).map((row) => ({
                                    id: row.id,
                                    label: row.title,
                                  }))
                                : (
                                    task?.accounts ??
                                    (task?.account ? [task.account] : [])
                                  ).map((row) => ({
                                    id: row.id,
                                    label: row.name,
                                  }));
                        return (
                          <TaskSelector
                            key={
                              kind +
                              (kind === "lead"
                                ? ""
                                : JSON.stringify(relations.lead))
                            }
                            multiple
                            leadIds={kind === "lead" ? [] : relations.lead}
                            kind={kind}
                            label={
                              kind === "contact"
                                ? "Associate task to contact"
                                : kind === "account"
                                  ? "Associate task to account"
                                  : kind === "lead"
                                    ? "Associate task to lead"
                                    : "Associate task to deal"
                            }
                            value={relations[kind]}
                            selectedLabels={[
                              ...options,
                              ...(createdLabels[kind] ?? []),
                            ]}
                            onCreate={
                              !USE_MOCK_DATA &&
                              (kind === "lead" ||
                                kind === "deal" ||
                                !relations.lead.length ||
                                canEditLeads) &&
                              relations[kind].length < 50 &&
                              (kind === "deal"
                                ? canCreate
                                : kind === "account"
                                  ? canCreateAccounts
                                  : canCreateContacts)
                                ? () => setCreating(kind)
                                : undefined
                            }
                            onChange={(ids) => changeRelations(kind, ids)}
                          />
                        );
                      })}
                  </div>
                </section>
              </fieldset>
              {task && (
                <dl className="space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
                  <div>Created {new Date(task.createdAt).toLocaleString()}</div>
                  {task.completedAt && (
                    <div>
                      Completed {new Date(task.completedAt).toLocaleString()}
                      {task.completedBy
                        ? " by " +
                          task.completedBy.firstName +
                          " " +
                          task.completedBy.lastName
                        : ""}
                    </div>
                  )}
                  {task.assignedByUser && (
                    <div>
                      Assigned by {task.assignedByUser.firstName}{" "}
                      {task.assignedByUser.lastName}
                    </div>
                  )}
                  {task.isArchived && <div>Archived</div>}
                </dl>
              )}
              {confirmArchive && (
                <div
                  role="alert"
                  className="rounded-lg border border-border p-3 text-sm"
                >
                  Archive this task? It will leave active views and remain in
                  the archive.
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void archive()}
                    >
                      Confirm archive
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirmArchive(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-border p-4">
              {task && !readOnly && canArchive && !task.isArchived ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmArchive(true)}
                >
                  Archive
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={onClose}
                >
                  Close
                </Button>
                {editable && (
                  <Button type="submit" disabled={busy}>
                    {busy ? "Saving…" : task ? "Save changes" : "Create task"}
                  </Button>
                )}
              </div>
            </footer>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
