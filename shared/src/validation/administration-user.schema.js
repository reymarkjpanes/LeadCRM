"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateAdministrationUserSchema = exports.CreateAdministrationUserSchema = exports.AdministrationPhoneSchema = exports.cleanText = void 0;
const zod_1 = require("zod");
const security_schema_1 = require("./security.schema");
// Check before trimming so surrounding control characters are not silently accepted.
const cleanText = (max) => zod_1.z.string()
    .refine(value => !/[\u0000-\u001f\u007f-\u009f]/.test(value), 'Control characters are not allowed.')
    .transform(value => value.trim()).pipe(zod_1.z.string().max(max));
exports.cleanText = cleanText;
exports.AdministrationPhoneSchema = (0, exports.cleanText)(32).superRefine((value, ctx) => {
    const local = value.startsWith('+63') ? value.slice(3) : value;
    const message = !local ? 'Phone number is required.'
        : !local.startsWith('9') ? 'Philippine mobile number must start with 9.'
            : !/^9\d{9}$/.test(local) ? 'Phone number must contain exactly 10 digits.' : null;
    if (message)
        ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message });
}).transform(value => value.startsWith('+63') ? value : `+63${value}`);
exports.CreateAdministrationUserSchema = zod_1.z.object({
    firstName: (0, exports.cleanText)(100).pipe(zod_1.z.string().min(1, 'First name is required.')),
    lastName: (0, exports.cleanText)(100).pipe(zod_1.z.string().min(1, 'Last name is required.')),
    email: security_schema_1.EmployeeEmailSchema,
    phone: exports.AdministrationPhoneSchema,
    // The existing user service accepts the canonical RoleDefinition.name.
    role: (0, exports.cleanText)(100).pipe(zod_1.z.string().min(1, 'Role is required.')),
    jobTitle: (0, exports.cleanText)(100).optional(),
    groupIds: zod_1.z.array(zod_1.z.string().uuid()).max(100).refine(ids => new Set(ids).size === ids.length, 'Choose each group once.').optional(),
}).strict();
exports.UpdateAdministrationUserSchema = exports.CreateAdministrationUserSchema.omit({ email: true }).partial()
    .extend({ status: zod_1.z.enum(['ACTIVE', 'INACTIVE']).optional() }).strict();
