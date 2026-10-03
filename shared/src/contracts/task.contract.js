"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_COLUMN_DEFINITIONS = exports.TaskOptionsQuerySchema = exports.TaskBulkSchema = exports.TaskQuerySchema = exports.UpdateTaskSchema = exports.CreateTaskSchema = exports.TASK_LINK_KINDS = exports.TaskStatusSchema = exports.TASK_STATUS_LABELS = exports.TASK_STATUSES = void 0;
exports.taskAssociationIds = taskAssociationIds;
exports.isTaskOverdue = isTaskOverdue;
exports.taskDateRange = taskDateRange;
exports.taskAssociationPatch = taskAssociationPatch;
const zod_1 = require("zod");
exports.TASK_STATUSES = [
    "pending",
    "in_progress",
    "blocked",
    "completed",
    "cancelled",
];
exports.TASK_STATUS_LABELS = {
    pending: "To do",
    in_progress: "In progress",
    blocked: "Blocked",
    completed: "Completed",
    cancelled: "Cancelled",
};
exports.TaskStatusSchema = zod_1.z.preprocess((value) => (value === "in-progress" ? "in_progress" : value), zod_1.z.enum(exports.TASK_STATUSES));
const recordId = zod_1.z.string().trim().min(1).max(128);
exports.TASK_LINK_KINDS = ["lead", "contact", "deal", "account"];
const linkIds = zod_1.z
    .array(recordId)
    .max(50)
    .transform((ids) => [...new Set(ids)]);
/** Plural lists are authoritative, including an explicit empty list. */
function taskAssociationIds(task, kind) {
    return task[`${kind}Ids`] ?? (task[`${kind}Id`] ? [task[`${kind}Id`]] : []);
}
function validateLinkInputs(data, ctx) {
    for (const kind of exports.TASK_LINK_KINDS) {
        if (data[`${kind}Ids`] !== undefined && data[`${kind}Id`] !== undefined)
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: [`${kind}Ids`],
                message: "Send either a single association or an association list, not both.",
            });
    }
}
const instant = zod_1.z.string().datetime({ offset: true });
const taskFields = zod_1.z.object({
    title: zod_1.z.string().trim().min(1, "Enter a task title.").max(255),
    description: zod_1.z.string().max(10000).nullable().optional(),
    status: exports.TaskStatusSchema.default("pending"),
    priority: zod_1.z.enum(["Low", "Medium", "High"]).default("Medium"),
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
exports.CreateTaskSchema = taskFields
    .strict()
    .superRefine(validateLinkInputs);
exports.UpdateTaskSchema = taskFields
    .partial()
    .extend({ reassignReason: zod_1.z.string().trim().max(1000).optional() })
    .strict()
    .superRefine(validateLinkInputs);
const queryBoolean = zod_1.z.preprocess((value) => (value === "true" ? true : value === "false" ? false : value), zod_1.z.boolean());
exports.TaskQuerySchema = zod_1.z
    .object({
    page: zod_1.z.coerce.number().int().min(1).max(1000000).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    status: exports.TaskStatusSchema.optional(),
    priority: zod_1.z.enum(["Low", "Medium", "High"]).optional(),
    state: zod_1.z.enum(["all", "active", "completed"]).default("all"),
    assignedUserId: recordId.optional(),
    leadId: recordId.optional(),
    contactId: recordId.optional(),
    dealId: recordId.optional(),
    accountId: recordId.optional(),
    search: zod_1.z.string().trim().max(255).optional(),
    archived: queryBoolean.default(false),
    overdue: queryBoolean.default(false),
    dueFrom: instant.optional(),
    dueTo: instant.optional(),
    sortBy: zod_1.z
        .enum(["dueDate", "title", "createdAt", "updatedAt"])
        .default("createdAt"),
    sortOrder: zod_1.z.enum(["asc", "desc"]).default("desc"),
})
    .strict()
    .refine((query) => !query.dueFrom ||
    !query.dueTo ||
    Date.parse(query.dueFrom) < Date.parse(query.dueTo), { message: "End date must be after start date." });
const bulkIds = zod_1.z
    .array(recordId)
    .min(1)
    .max(100)
    .transform((ids) => [...new Set(ids)]);
exports.TaskBulkSchema = zod_1.z.discriminatedUnion("operation", [
    zod_1.z.object({ operation: zod_1.z.literal("complete"), ids: bulkIds }).strict(),
    zod_1.z.object({ operation: zod_1.z.literal("archive"), ids: bulkIds }).strict(),
    zod_1.z
        .object({
        operation: zod_1.z.literal("assign"),
        ids: bulkIds,
        assignedUserId: recordId,
    })
        .strict(),
    zod_1.z
        .object({
        operation: zod_1.z.literal("reschedule"),
        ids: bulkIds,
        dueDate: instant,
    })
        .strict(),
]);
exports.TaskOptionsQuerySchema = zod_1.z
    .object({
    kind: zod_1.z.enum(["user", "lead", "contact", "deal", "account"]),
    leadIds: zod_1.z
        .preprocess((value) => typeof value === "string" ? (value ? value.split(",") : []) : value, linkIds)
        .default([]),
    search: zod_1.z.string().trim().max(255).default(""),
})
    .strict();
function isTaskOverdue(task, now = Date.now()) {
    return (!task.isArchived &&
        !["completed", "cancelled"].includes(task.status) &&
        !!task.dueDate &&
        Date.parse(task.dueDate) < now);
}
/** Calendar boundaries are local; the wire contract always carries instants. */
function taskDateRange(period, now = new Date()) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === "week")
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + (period === "week" ? 7 : 1));
    return { dueFrom: start.toISOString(), dueTo: end.toISOString() };
}
exports.TASK_COLUMN_DEFINITIONS = [
    {
        id: "action",
        label: "Action",
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
    ...[
        "status",
        "priority",
        "dueDate",
        "lead",
        "contact",
        "deal",
        "account",
        "assignedUser",
        "createdAt",
        "completedAt",
    ].map((id, index) => ({
        id,
        label: {
            status: "Status",
            priority: "Priority",
            dueDate: "Due date",
            lead: "Lead",
            contact: "Contact",
            deal: "Deal",
            account: "Account",
            assignedUser: "Task owner",
            createdAt: "Created",
            completedAt: "Completed",
        }[id],
        required: false,
        defaultVisible: !["createdAt", "completedAt"].includes(id),
        defaultOrder: index + 2,
        group: "Tasks",
        priority: "medium",
    })),
];
/** Keep the first link available to existing single-link consumers. */
function taskAssociationPatch(input) {
    const patch = {};
    for (const kind of exports.TASK_LINK_KINDS) {
        if (input[`${kind}Ids`] !== undefined || input[`${kind}Id`] !== undefined) {
            const ids = taskAssociationIds(input, kind);
            patch[`${kind}Ids`] = ids;
            patch[`${kind}Id`] = ids[0] ?? null;
        }
    }
    return patch;
}
