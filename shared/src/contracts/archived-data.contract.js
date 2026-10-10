"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchiveRestoreParamsSchema = exports.ArchiveQuerySchema = exports.ArchiveTypeSchema = exports.ARCHIVE_TYPES = void 0;
const zod_1 = require("zod");
exports.ARCHIVE_TYPES = ['Lead', 'Contact', 'Account', 'Deal', 'User', 'Task', 'Campaign', 'Workflow', 'Role'];
exports.ArchiveTypeSchema = zod_1.z.enum(exports.ARCHIVE_TYPES);
exports.ArchiveQuerySchema = zod_1.z.object({
    type: exports.ArchiveTypeSchema.optional(),
    search: zod_1.z.string().trim().max(200).optional(),
    sortBy: zod_1.z.enum(['archivedAt', 'name', 'type', 'detail']).optional(),
    sortOrder: zod_1.z.enum(['asc', 'desc']).optional(),
    page: zod_1.z.coerce.number().int().min(1).max(100000).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(50).default(25),
}).strict();
// Types with no existing restore route. Other types keep their established APIs.
exports.ArchiveRestoreParamsSchema = zod_1.z.object({
    type: zod_1.z.enum(['Pipeline', 'Role', 'Workflow', 'Campaign', 'Template', 'Task']),
    id: zod_1.z.string().uuid(),
}).strict();
