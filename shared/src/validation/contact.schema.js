"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateContactSchema = exports.ContactSchema = void 0;
const zod_1 = require("zod");
const record_experience_1 = require("../contracts/record-experience");
exports.ContactSchema = zod_1.z.object({
    firstName: zod_1.z.string().min(1, 'First name is required').max(100),
    lastName: zod_1.z.string().min(1, 'Last name is required').max(100),
    email: zod_1.z.string().email('Invalid email address').optional().or(zod_1.z.literal('')),
    phone: zod_1.z.string().optional(),
    company: zod_1.z.string().optional(),
    status: record_experience_1.CrmStatusSchema.default('Warm'),
    source: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
});
exports.UpdateContactSchema = exports.ContactSchema.partial();
