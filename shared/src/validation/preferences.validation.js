"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SaveColumnsBodySchema = exports.ColumnItemSchema = exports.ColumnModuleParamsSchema = void 0;
const zod_1 = require("zod");
/**
 * Shared Zod validation schemas for column preference endpoints.
 * Used by both backend (request validation) and frontend (form validation).
 */
/** Path parameter schema — validates the :module URL parameter. */
exports.ColumnModuleParamsSchema = zod_1.z.object({
    module: zod_1.z.string().min(1).max(50).regex(/^[a-z][a-z0-9_-]*$/, {
        message: 'Module must start with a lowercase letter and contain only lowercase letters, digits, hyphens, or underscores',
    }),
});
/** Single column item in a save payload. */
exports.ColumnItemSchema = zod_1.z.object({
    id: zod_1.z.string().min(1).max(255).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
        message: 'Column ID must start with a letter and contain only letters, numbers, hyphens, or underscores',
    }),
    visible: zod_1.z.boolean(),
    order: zod_1.z.number().int().nonnegative(),
});
/** Full save payload — max 64KB enforced at middleware level. */
exports.SaveColumnsBodySchema = zod_1.z.object({
    columns: zod_1.z.array(exports.ColumnItemSchema).min(1).max(100),
}).refine((data) => new Set(data.columns.map((c) => c.id)).size === data.columns.length, { message: 'Duplicate column ids are not allowed' });
