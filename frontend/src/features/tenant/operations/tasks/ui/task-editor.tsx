"use client";
import { ConfirmActionDialog } from '@/shared/components/crm/confirm-action-dialog';
import { ManilaDateTimePicker } from "@/shared/components/ui/manila-date-time-picker";
import { taskRecordOptions } from "../task-relations";
import { useId, useRef, useState } from "react";
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
import {
  PanelSectionHeading,
  panelBodyClass,
  panelCloseClass,
  panelFooterClass,
  panelHeaderClass,
  panelInputClass,
  panelLabelClass,
  panelPrimaryButtonClass,
  panelSecondaryButtonClass,
  panelSurfaceClass,
  panelTitleClass,
} from "@/shared/components/side-panel-styles";
import {
  isPastManilaTaskDueDateTime,
  manilaCurrentDate,
  manilaLocalDateTime,
  manilaTaskDueInstant,
  resolveManilaTaskDueDateTime,
} from "../task-data";

export type TaskLinks = TaskLinkInput;
import { TaskSelector } from "./task-selector";
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
    manilaLocalDateTime(
      task?.dueDate ?? new Date(Date.now() + 86400000).toISOString(),
    ),
  );
  const [dueDraft, setDueDraft] = useState<string | null>(null);
  const dueTrigger = useRef<HTMLButtonElement>(null);
  const closeDuePicker = () => { setDueDraft(null); dueTrigger.current?.focus({ preventScroll: true }); };
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
  const heading = useId();
  const save = async () => {
    if (busy || !editable) return;
    setBusy(true);
    setError("");
    try {
      if (!title.trim()) throw new Error("Enter a task title.");
      if (!assignedUserId) throw new Error("Select a task owner.");
      const dueDateUnchanged = !!task && dueDate === manilaLocalDateTime(task.dueDate);
      const resolvedDueDate = resolveManilaTaskDueDateTime(dueDate);
      if (!dueDateUnchanged) {
        if (resolvedDueDate.slice(0, 10) < manilaCurrentDate())
          throw new Error("Choose today or a future due date.");
        if (isPastManilaTaskDueDateTime(resolvedDueDate))
          throw new Error("Choose a due date and time in the future.");
      }
      if (resolvedDueDate !== dueDate) setDueDate(resolvedDueDate);
      const data = {
        title,
        description,
        status,
        priority,
        dueDate: dueDateUnchanged
          ? task.dueDate
          : manilaTaskDueInstant(resolvedDueDate),
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
      throw new Error(e instanceof Error ? e.message : "Unable to archive task. Please try again.");
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
        aria-labelledby={heading}
        showClose={!busy}
        className={panelSurfaceClass}
        closeClassName={panelCloseClass + " right-3 top-3 sm:right-5"}
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
        <header className={panelHeaderClass + " pr-16 sm:pr-20"}>
          <h2 id={heading} className={panelTitleClass}>
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
            <div className={panelBodyClass + " space-y-6"}>
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
                className="min-w-0 space-y-6"
              >
                <section className="space-y-4">
                  <PanelSectionHeading number={1}>Task Information</PanelSectionHeading>
                  <label className="block space-y-1.5">
                    <span className={panelLabelClass}>Title <span className="text-red-500">*</span></span>
                    <input
                      className={panelInputClass}
                      required
                      maxLength={255}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="min-w-0 space-y-1.5">
                      <span className={panelLabelClass}>Status</span>
                      <select
                        className={panelInputClass}
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
                    <label className="min-w-0 space-y-1.5">
                      <span className={panelLabelClass}>Priority</span>
                      <select
                        className={panelInputClass}
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
                </section>
                <section className="space-y-4">
                  <PanelSectionHeading number={2}>Schedule &amp; Assignment</PanelSectionHeading>
                  <div className="min-w-0 space-y-1.5">
                    <label htmlFor={`${heading}-due`} className={panelLabelClass}>Due date and time <span className="text-red-500">*</span></label>
                    <button id={`${heading}-due`} ref={dueTrigger} type="button" className={panelInputClass + " text-left"} aria-expanded={dueDraft !== null} aria-controls={`${heading}-due-picker`} onClick={() => { if (dueDraft === null) setDueDraft(dueDate); else closeDuePicker(); }}>{dueDate.replace('T', ' ')}</button>
                    {dueDraft !== null && <ManilaDateTimePicker id={`${heading}-due-picker`} value={dueDraft} prefix="Due" label="Choose due date and time" rollPastToday onCancel={closeDuePicker} onDone={value => { setDueDate(value); closeDuePicker(); }} />}
                  </div>
                  <TaskSelector
                    appearance="panel"
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
                </section>
                <section className="space-y-4">
                  <PanelSectionHeading number={3}>Additional Information</PanelSectionHeading>
                  <label className="block space-y-1.5">
                    <span className={panelLabelClass}>Notes</span>
                    <textarea
                      rows={5}
                      maxLength={10000}
                      className={panelInputClass}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {description.length}/10000
                    </span>
                  </label>
                </section>
                <section>
                  <PanelSectionHeading number={4}>
                    Associate task (
                    {Object.values(relations).reduce(
                      (sum, ids) => sum + ids.length,
                      0,
                    )}
                    )
                  </PanelSectionHeading>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
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
                        const options = taskRecordOptions(task, kind);
                        return (
                          <TaskSelector
                            appearance="panel"
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
              {!!task?.relatedRecords?.length && (
                <section aria-label="Related CRM records" className="space-y-3 rounded-xl border border-border p-4">
                  <h3 className="text-sm font-semibold">Related CRM records</h3>
                  <p className="text-xs text-muted-foreground">Connections from the records associated above. These do not change the task’s selected associations.</p>
                  <ul className="space-y-3">
                    {task.relatedRecords.map(record => <li key={record.kind + record.id} className="min-w-0 text-sm [overflow-wrap:anywhere]">
                      <span className="capitalize text-muted-foreground">{record.kind}: </span>{record.label}
                      <p className="text-xs text-muted-foreground">Via {record.via}</p>
                    </li>)}
                  </ul>
                </section>
              )}
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
            </div>
            <footer className={panelFooterClass + " justify-between"}>
              {task && !readOnly && canArchive && !task.isArchived ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-[42px] rounded-xl"
                  disabled={busy}
                  onClick={() => setConfirmArchive(true)}
                >
                  Archive
                </Button>
              ) : (
                <span />
              )}
              <div className="ml-auto flex flex-wrap justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className={panelSecondaryButtonClass}
                  disabled={busy}
                  onClick={onClose}
                >
                  Close
                </Button>
                {editable && (
                  <Button type="submit" className={panelPrimaryButtonClass} disabled={busy}>
                    {busy ? "Saving…" : task ? "Save changes" : "Create task"}
                  </Button>
                )}
              </div>
            </footer>
          </form>
        )}
        <ConfirmActionDialog open={confirmArchive} onOpenChange={setConfirmArchive}
          title="Archive task?" description="This task will leave active views and can be restored from Archived Data."
          variant="destructive" confirmLabel="Archive" isLoading={busy}
          confirmDisabled={!canArchive || readOnly || !!task?.isArchived} onConfirm={archive} />
      </SheetContent>
    </Sheet>
  );
}
