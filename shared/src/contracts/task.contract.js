"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_COLUMN_DEFINITIONS = exports.TaskOptionsQuerySchema = exports.TaskBulkSchema = exports.TaskQuerySchema = exports.UpdateTaskSchema = exports.CreateTaskSchema = exports.TaskDescriptionSchema = exports.TaskTitleSchema = exports.TASK_DESCRIPTION_MAX_LENGTH = exports.TASK_TITLE_MAX_LENGTH = exports.TASK_LINK_KINDS = exports.TaskDisplayStatusSchema = exports.StoredTaskStatusSchema = exports.TaskStatusSchema = exports.TASK_STATUS_LABELS = exports.TASK_STATUSES = exports.TASK_MANUAL_STATUSES = void 0;
exports.taskAssociationIds = taskAssociationIds;
exports.isTaskOverdue = isTaskOverdue;
exports.taskDisplayStatus = taskDisplayStatus;
exports.taskDateRange = taskDateRange;
exports.taskAssociationPatch = taskAssociationPatch;
const text_length_1 = require("../validation/text-length");
const zod_1 = require("zod");
exports.TASK_MANUAL_STATUSES = [
    "pending",
    "in_progress",
    "completed",
    "cancelled",
];
exports.TASK_STATUSES = ["pending", "in_progress", "completed", "overdue", "cancelled"];
exports.TASK_STATUS_LABELS = {
    pending: "To do",
    in_progress: "In progress",
    completed: "Completed",
    overdue: "Overdue",
    cancelled: "Cancelled",
};
exports.TaskStatusSchema = zod_1.z.preprocess((value) => (value === "in-progress" ? "in_progress" : value), zod_1.z.enum(exports.TASK_MANUAL_STATUSES));
/** Legacy storage is readable without rewriting history or accepting retired writes. */
exports.StoredTaskStatusSchema = zod_1.z.preprocess(value => value === "blocked" ? "pending" : value, exports.TaskStatusSchema);
exports.TaskDisplayStatusSchema = zod_1.z.preprocess(value => value === "in-progress" ? "in_progress" : value, zod_1.z.enum(exports.TASK_STATUSES));
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
function validateDealWrites(data, ctx) {
    validateLinkInputs(data, ctx);
    for (const kind of ['lead', 'contact', 'account']) {
        if (data[`${kind}Id`] !== undefined || data[`${kind}Ids`] !== undefined) {
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, path: [`${kind}Ids`],
                message: 'Tasks accept Deal associations only. Related CRM records are resolved through Deals.' });
        }
    }
}
const instant = zod_1.z.string().datetime({ offset: true });
exports.TASK_TITLE_MAX_LENGTH = 255;
exports.TASK_DESCRIPTION_MAX_LENGTH = 1000;
exports.TaskTitleSchema = zod_1.z.string().refine(value => !value.includes('\u0000'), 'Text must not contain NUL characters.')
    .transform(value => value.trim()).pipe(zod_1.z.string().min(1, 'Enter a task title.').max(exports.TASK_TITLE_MAX_LENGTH, (0, text_length_1.maxLengthMessage)('Task title', exports.TASK_TITLE_MAX_LENGTH)));
exports.TaskDescriptionSchema = zod_1.z.string().max(exports.TASK_DESCRIPTION_MAX_LENGTH, (0, text_length_1.maxLengthMessage)('Task description', exports.TASK_DESCRIPTION_MAX_LENGTH))
    .refine(value => !value.includes('\u0000'), 'Text must not contain NUL characters.').nullable().optional();
const taskFields = zod_1.z.object({
    title: exports.TaskTitleSchema,
    description: exports.TaskDescriptionSchema,
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
    .extend({
    requestId: zod_1.z.string().uuid().optional(),
    status: zod_1.z.literal("pending").default("pending"),
    assignedUserId: recordId.optional(),
})
    .strict()
    .superRefine((data, ctx) => {
    validateDealWrites(data, ctx);
    if (!taskAssociationIds(data, 'deal').length)
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom, path: ['dealIds'],
            message: 'Select at least one Deal to associate with this task.',
        });
});
exports.UpdateTaskSchema = taskFields
    .partial()
    .extend({ reassignReason: zod_1.z.string().trim().max(1000).optional(), expectedUpdatedAt: instant.optional() })
    .strict()
    .superRefine((data, ctx) => {
    validateDealWrites(data, ctx);
    if ((data.dealIds !== undefined || data.dealId !== undefined) && !taskAssociationIds(data, 'deal').length)
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom, path: ['dealIds'],
            message: 'Select at least one Deal to associate with this task.',
        });
});
const queryBoolean = zod_1.z.preprocess((value) => (value === "true" ? true : value === "false" ? false : value), zod_1.z.boolean());
exports.TaskQuerySchema = zod_1.z
    .object({
    page: zod_1.z.coerce.number().int().min(1).max(1000000).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    status: exports.TaskDisplayStatusSchema.optional(),
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
    accountId: recordId.optional(),
    productInterestId: zod_1.z.string().uuid().optional(),
    category: zod_1.z.string().trim().max(100).optional(),
    page: zod_1.z.coerce.number().int().min(1).max(100000).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(50).default(25),
    selectAll: queryBoolean.default(false),
})
    .strict();
function isTaskOverdue(task, now = Date.now()) {
    return (!task.isArchived &&
        !["completed", "cancelled"].includes(task.status) &&
        !!task.dueDate &&
        Date.parse(task.dueDate) < now);
}
function taskDisplayStatus(task, now = Date.now()) {
    return isTaskOverdue(task, now) ? "overdue" : exports.StoredTaskStatusSchema.parse(task.status);
}
/** Task pickers and calendar filters share the workspace's Manila timezone. */
function taskDateRange(period, now = new Date()) {
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
exports.TASK_COLUMN_DEFINITIONS = [
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
    ...[
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
            assignedUser: "Assigned Agent",
            createdBy: "Task Owner (Created by)",
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
