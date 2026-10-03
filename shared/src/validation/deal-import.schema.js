"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateDealImportSchema = exports.ImportDealRowSchema = void 0;
const zod_1 = require("zod");
const administration_user_schema_1 = require("./administration-user.schema");
const optionalText = (max) => (0, administration_user_schema_1.cleanText)(max).optional().default('');
exports.ImportDealRowSchema = zod_1.z.object({
    title: (0, administration_user_schema_1.cleanText)(255).pipe(zod_1.z.string().min(1, 'Deal title is required.')),
    pipeline: (0, administration_user_schema_1.cleanText)(255).pipe(zod_1.z.string().min(1, 'Pipeline is required.')),
    stage: (0, administration_user_schema_1.cleanText)(255).pipe(zod_1.z.string().min(1, 'Stage is required.')),
    value: optionalText(32).refine(value => !value || (/^\d+(\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 999999999999), 'Value must be a positive amount, at most 999999999999, with up to two decimal places.'),
    priority: optionalText(10).transform(value => value.toUpperCase() || 'MEDIUM').pipe(zod_1.z.enum(['LOW', 'MEDIUM', 'HIGH'])),
    expectedCloseDate: optionalText(10).refine(value => {
        if (!value)
            return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
            return false;
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, 'Expected close date must be a real date in YYYY-MM-DD format.'),
    account: optionalText(255),
    contact: optionalText(255),
    assignedUser: optionalText(254),
}).strict();
const rawFields = Object.fromEntries(Object.keys(exports.ImportDealRowSchema.shape).map(key => [key, zod_1.z.string().max(10000).optional().default('')]));
exports.CreateDealImportSchema = zod_1.z.object({
    fileName: (0, administration_user_schema_1.cleanText)(255).pipe(zod_1.z.string().min(1)),
    rows: zod_1.z.array(zod_1.z.object({ ...rawFields, rowNumber: zod_1.z.number().int().min(2) }).strict()).min(1).max(5000)
        .refine(rows => new Set(rows.map(row => row.rowNumber)).size === rows.length, 'Row numbers must be unique.'),
}).strict();
