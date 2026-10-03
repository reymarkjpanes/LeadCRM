"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnboardingProgressSchema = exports.CompanySetupSchema = exports.RegisterSchema = exports.ChangePasswordSchema = exports.StrongPasswordSchema = void 0;
const zod_1 = require("zod");
const security_schema_1 = require("./security.schema");
exports.StrongPasswordSchema = zod_1.z.string().min(8, 'Use at least 8 characters.').max(72, 'Use no more than 72 characters.').refine(value => new TextEncoder().encode(value).length <= 72, 'Password must be no more than 72 bytes.').refine(value => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s])/.test(value), 'Use uppercase and lowercase letters, a number, and a special character');
exports.ChangePasswordSchema = zod_1.z.object({ password: exports.StrongPasswordSchema }).strict();
exports.RegisterSchema = zod_1.z.object({
    firstName: zod_1.z.string().trim().min(2, 'First name is required').max(100),
    lastName: zod_1.z.string().trim().min(2, 'Last name is required').max(100),
    email: security_schema_1.EmployeeEmailSchema,
    password: exports.StrongPasswordSchema,
    acceptTerms: zod_1.z.boolean().optional(),
}).superRefine((data, ctx) => {
    if (data.acceptTerms !== true) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['acceptTerms'],
            message: 'You must accept the terms and conditions',
        });
    }
});
const WebsiteSchema = zod_1.z.string().trim().max(2048).url('Enter a valid website URL')
    .refine(value => /^https?:\/\//i.test(value), 'Use an http or https website');
exports.CompanySetupSchema = zod_1.z.object({
    companyName: zod_1.z.string().trim().min(2, 'Company name is required').max(100),
    industry: zod_1.z.string().trim().min(1, 'Industry is required').max(100),
    companySize: zod_1.z.string().trim().min(1, 'Company size is required').max(20),
    website: WebsiteSchema.or(zod_1.z.literal('')).optional(),
});
exports.OnboardingProgressSchema = zod_1.z.object({
    expectedStep: zod_1.z.number().int().min(0).max(2),
    step: zod_1.z.number().int().min(0).max(2),
}).refine(data => Math.abs(data.step - data.expectedStep) === 1, {
    message: 'Move one onboarding step at a time',
    path: ['step'],
});
