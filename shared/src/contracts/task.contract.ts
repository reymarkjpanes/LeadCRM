import { maxLengthMessage } from '../validation/text-length';
import type { ColumnDefinition } from "../types/preferences";
import { z } from "zod";

export const TASK_MANUAL_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_MANUAL_STATUSES)[number];
export const TASK_STATUSES = ["pending", "in_progress", "completed", "overdue", "cancelled"] as const;
export type TaskDisplayStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskDisplayStatus, string> = {
  pending: "To do",
  in_progress: "In progress",
  completed: "Completed",
  overdue: "Overdue",
  cancelled: "Cancelled",
};
export const TaskStatusSchema = z.preprocess(
  (value) => (value === "in-progress" ? "in_progress" : value),
  z.enum(TASK_MANUAL_STATUSES),
);
/** Legacy storage is readable without rewriting history or accepting retired writes. */
export const StoredTaskStatusSchema = z.preprocess(
  value => value === "blocked" ? "pending" : value,
  TaskStatusSchema,
);
export const TaskDisplayStatusSchema = z.preprocess(
  value => value === "in-progress" ? "in_progress" : value,
  z.enum(TASK_STATUSES),
);
const recordId = z.string().trim().min(1).max(128);
export const TASK_LINK_KINDS = ["lead", "contact", "deal", "account"] as const;
export type TaskLinkKind = (typeof TASK_LINK_KINDS)[number];
export type TaskAssociations = { [K in TaskLinkKind as `${K}Ids`]?: string[] };
export type TaskLinkInput = TaskAssociations & {
  [K in TaskLinkKind as `${K}Id`]?: string | null;
};
const linkIds = z
  .array(recordId)
  .max(50)
  .transform((ids) => [...new Set(ids)]);
/** Plural lists are authoritative, including an explicit empty list. */
export function taskAssociationIds(
  task: TaskLinkInput,
  kind: TaskLinkKind,
): string[] {
  return task[`${kind}Ids`] ?? (task[`${kind}Id`] ? [task[`${kind}Id`]!] : []);
}
function validateLinkInputs(data: TaskLinkInput, ctx: z.RefinementCtx) {
  for (const kind of TASK_LINK_KINDS) {
    if (data[`${kind}Ids`] !== undefined && data[`${kind}Id`] !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [`${kind}Ids`],
        message:
          "Send either a single association or an association list, not both.",
      });
  }
}
function validateDealWrites(data: TaskLinkInput, ctx: z.RefinementCtx) {
  validateLinkInputs(data, ctx);
  for (const kind of ['lead', 'contact', 'account'] as const) {
    if (data[`${kind}Id`] !== undefined || data[`${kind}Ids`] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [`${kind}Ids`],
        message: 'Tasks accept Deal associations only. Related CRM records are resolved through Deals.' });
    }
  }
}
const instant = z.string().datetime({ offset: true });
export const TASK_TITLE_MAX_LENGTH = 255;
export const TASK_DESCRIPTION_MAX_LENGTH = 1000;
export const TaskTitleSchema = z.string().refine(value => !value.includes('\u0000'), 'Text must not contain NUL characters.')
  .transform(value => value.trim()).pipe(z.string().min(1, 'Enter a task title.').max(TASK_TITLE_MAX_LENGTH, maxLengthMessage('Task title', TASK_TITLE_MAX_LENGTH)));
export const TaskDescriptionSchema = z.string().max(TASK_DESCRIPTION_MAX_LENGTH, maxLengthMessage('Task description', TASK_DESCRIPTION_MAX_LENGTH))
  .refine(value => !value.includes('\u0000'), 'Text must not contain NUL characters.').nullable().optional();

const taskFields = z.object({
  title: TaskTitleSchema,
  description: TaskDescriptionSchema,
  status: TaskStatusSchema.default("pending"),
  priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
  dueDate: instant,
  reminderAt: instant.nullable().optional(),
  assignedUserId: recordId,
  leadId: recordId.nullable().optional(),
  contactId: recordId.nullable().optional(),
  dealId: recordId.nullable().optional(),
  accountId: recordId.nullable().optional(),
  leadIds: linkIds.optional(),
  contactIds: linkIds.optional(),
  dealIds: linkIds.optional(),
  accountIds: linkIds.optional(),
});
export const CreateTaskSchema = taskFields
  .extend({
    requestId: z.string().uuid().optional(),
    status: z.literal("pending").default("pending"),
    assignedUserId: recordId.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    validateDealWrites(data, ctx);
    if (!taskAssociationIds(data, 'deal').length) ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ['dealIds'],
      message: 'Select at least one Deal to associate with this task.',
    });
  });
export const UpdateTaskSchema = taskFields
  .partial()
  .extend({ reassignReason: z.string().trim().max(1000).optional(), expectedUpdatedAt: instant.optional() })
  .strict()
  .superRefine((data, ctx) => {
    validateDealWrites(data, ctx);
    if ((data.dealIds !== undefined || data.dealId !== undefined) && !taskAssociationIds(data, 'deal').length) ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ['dealIds'],
      message: 'Select at least one Deal to associate with this task.',
    });
  });
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;
export type CreateTaskDto = z.output<typeof CreateTaskSchema>;
export type UpdateTaskDto = z.output<typeof UpdateTaskSchema>;
const queryBoolean = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean(),
);
export const TaskQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: TaskDisplayStatusSchema.optional(),
    priority: z.enum(["Low", "Medium", "High"]).optional(),
    state: z.enum(["all", "active", "completed"]).default("all"),
    assignedUserId: recordId.optional(),
    leadId: recordId.optional(),
    contactId: recordId.optional(),
    dealId: recordId.optional(),
    accountId: recordId.optional(),
    search: z.string().trim().max(255).optional(),
    archived: queryBoolean.default(false),
    overdue: queryBoolean.default(false),
    dueFrom: instant.optional(),
    dueTo: instant.optional(),
    sortBy: z
      .enum(["dueDate", "title", "createdAt", "updatedAt"])
      .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .refine(
    (query) =>
      !query.dueFrom ||
      !query.dueTo ||
      Date.parse(query.dueFrom) < Date.parse(query.dueTo),
    { message: "End date must be after start date." },
  );
export type TaskQuery = z.output<typeof TaskQuerySchema>;
export type TaskListQuery = Partial<TaskQuery>;
const bulkIds = z
  .array(recordId)
  .min(1)
  .max(100)
  .transform((ids) => [...new Set(ids)]);
export const TaskBulkSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("complete"), ids: bulkIds }).strict(),
  z.object({ operation: z.literal("archive"), ids: bulkIds }).strict(),
  z
    .object({
      operation: z.literal("assign"),
      ids: bulkIds,
      assignedUserId: recordId,
    })
    .strict(),
  z
    .object({
      operation: z.literal("reschedule"),
      ids: bulkIds,
      dueDate: instant,
    })
    .strict(),
]);
export type TaskBulkInput = z.input<typeof TaskBulkSchema>;
export interface TaskBulkResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}
export interface TaskPerson {
  id: string;
  firstName: string;
  lastName: string;
}
/** Display-only CRM connections of records explicitly associated with a task. */
export interface TaskRelatedRecord {
  kind: TaskLinkKind;
  id: string;
  label: string;
  via: string;
}
export interface TaskRecord extends TaskAssociations {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** Calculated from saved status and dueDate; never accepted as a write. */
  displayStatus?: TaskDisplayStatus;
  priority?: "Low" | "Medium" | "High";
  dueDate: string;
  reminderAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  assignedUserId: string;
  createdById?: string | null;
  assignedById?: string | null;
  completedById?: string | null;
  completedAt?: string | null;
  isArchived?: boolean;
  leadId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  accountId?: string | null;
  leads?: TaskPerson[];
  contacts?: TaskPerson[];
  deals?: { id: string; title: string }[];
  accounts?: { id: string; name: string }[];
  assignedUser?: TaskPerson | null;
  createdBy?: TaskPerson | null;
  assignedByUser?: TaskPerson | null;
  completedBy?: TaskPerson | null;
  account?: { id: string; name: string } | null;
  lead?: TaskPerson | null;
  contact?: TaskPerson | null;
  deal?: { id: string; title: string } | null;
  relatedRecords?: TaskRelatedRecord[];
}
export interface TaskPage {
  data: TaskRecord[];
  meta: { total: number; page: number; limit: number; hasMore: boolean };
}
export interface TaskSummary {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  byStatus: Record<TaskDisplayStatus, number>;
  evaluatedAt?: string;
  nextStatusChangeAt?: string | null;
  workload: {
    assignedUserId: string;
    name: string;
    pending: number;
    inProgress: number;
    overdue: number;
    total: number;
  }[];
}
export const TaskOptionsQuerySchema = z
  .object({
    kind: z.enum(["user", "lead", "contact", "deal", "account"]),
    leadIds: z
      .preprocess(
        (value) =>
          typeof value === "string" ? (value ? value.split(",") : []) : value,
        linkIds,
      )
      .default([]),
    search: z.string().trim().max(255).default(""),
    accountId: recordId.optional(),
    productInterestId: z.string().uuid().optional(),
    category: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    selectAll: queryBoolean.default(false),
  })
  .strict();
export type TaskOptionKind = z.infer<typeof TaskOptionsQuerySchema>["kind"];
export interface TaskOption {
  id: string;
  label: string;
}
export function isTaskOverdue(
  task: { status: string; dueDate?: string | null; isArchived?: boolean },
  now = Date.now(),
): boolean {
  return (
    !task.isArchived &&
    !["completed", "cancelled"].includes(task.status) &&
    !!task.dueDate &&
    Date.parse(task.dueDate) < now
  );
}
export function taskDisplayStatus(
  task: { status: string; dueDate?: string | null; isArchived?: boolean },
  now = Date.now(),
): TaskDisplayStatus {
  return isTaskOverdue(task, now) ? "overdue" : StoredTaskStatusSchema.parse(task.status);
}
/** Task pickers and calendar filters share the workspace's Manila timezone. */
export function taskDateRange(
  period: "today" | "week",
  now = new Date(),
): { dueFrom: string; dueTo: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const start = new Date(Date.UTC(Number(date.year), Number(date.month) - 1, Number(date.day)));
  if (period === "week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (period === "week" ? 7 : 1));
  const offset = 8 * 60 * 60 * 1000;
  return { dueFrom: new Date(start.getTime() - offset).toISOString(), dueTo: new Date(end.getTime() - offset).toISOString() };
}

export const TASK_COLUMN_DEFINITIONS: ColumnDefinition[] = [
  {
    id: "action",
    label: "Action",
    fixedPosition: 'first',
    required: true,
    defaultVisible: true,
    defaultOrder: 0,
    group: "Tasks",
    priority: "required",
  },
  {
    id: "title",
    label: "Task title",
    required: true,
    defaultVisible: true,
    defaultOrder: 1,
    group: "Tasks",
    priority: "required",
  },
  ...(
    [
      "status",
      "priority",
      "dueDate",
      "lead",
      "contact",
      "deal",
      "account",
      "assignedUser",
      "createdBy",
      "createdAt",
      "completedAt",
    ] as const
  ).map((id, index) => ({
    id,
    label: {
      status: "Status",
      priority: "Priority",
      dueDate: "Due date",
      lead: "Lead",
      contact: "Contact",
      deal: "Deal",
      account: "Account",
      assignedUser: "Assigned Agent",
      createdBy: "Task Owner (Created by)",
      createdAt: "Created",
      completedAt: "Completed",
    }[id],
    required: false,
    defaultVisible: !["createdAt", "completedAt"].includes(id),
    defaultOrder: index + 2,
    group: "Tasks",
    priority: "medium" as const,
  })),
];

/** Keep the first link available to existing single-link consumers. */
export function taskAssociationPatch(input: TaskLinkInput): TaskLinkInput {
  const patch: TaskLinkInput = {};
  for (const kind of TASK_LINK_KINDS) {
    if (input[`${kind}Ids`] !== undefined || input[`${kind}Id`] !== undefined) {
      const ids = taskAssociationIds(input, kind);
      patch[`${kind}Ids`] = ids;
      patch[`${kind}Id`] = ids[0] ?? null;
    }
  }
  return patch;
}
