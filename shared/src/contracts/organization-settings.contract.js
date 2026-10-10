"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateOrganizationSettingsSchema = exports.ORGANIZATION_PHONE_ERROR = exports.OrganizationRequiredFieldsSchema = exports.ORGANIZATION_FIELD_LIMIT_ERRORS = exports.ORGANIZATION_FIELD_LIMITS = void 0;
exports.normalizeOrganizationPhone = normalizeOrganizationPhone;
exports.formatOrganizationPhone = formatOrganizationPhone;
const zod_1 = require("zod");
const company_industries_1 = require("../constants/company-industries");
exports.ORGANIZATION_FIELD_LIMITS = { name: 150, industry: 32, email: 254, phone: 24, domain: 253, address: 500 };
exports.ORGANIZATION_FIELD_LIMIT_ERRORS = {
    name: `Organization name must not exceed ${exports.ORGANIZATION_FIELD_LIMITS.name} characters.`,
    industry: `Use at most ${exports.ORGANIZATION_FIELD_LIMITS.industry} characters`,
    email: `Email must not exceed ${exports.ORGANIZATION_FIELD_LIMITS.email} characters.`,
    phone: `Phone must not exceed ${exports.ORGANIZATION_FIELD_LIMITS.phone} characters.`,
    domain: `Domain must not exceed ${exports.ORGANIZATION_FIELD_LIMITS.domain} characters.`,
    address: `Address must not exceed ${exports.ORGANIZATION_FIELD_LIMITS.address} characters.`,
};
const text = (limit, multiline = false, maxMessage = `Use at most ${limit} characters`) => zod_1.z.string().trim().max(limit, maxMessage)
    .refine(value => !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/ : /[\u0000-\u001f\u007f<>]/).test(value), 'Enter plain text without markup or control characters');
const optionalText = (limit, maxMessage = `Use at most ${limit} characters`) => text(limit, false, maxMessage).nullable().optional().transform(value => value === '' ? null : value);
exports.OrganizationRequiredFieldsSchema = zod_1.z.object({
    name: text(exports.ORGANIZATION_FIELD_LIMITS.name, false, exports.ORGANIZATION_FIELD_LIMIT_ERRORS.name).refine(value => value.length > 0, 'Organization name is required'),
    email: zod_1.z.string().trim().min(1, 'Email is required').max(exports.ORGANIZATION_FIELD_LIMITS.email, exports.ORGANIZATION_FIELD_LIMIT_ERRORS.email)
        .email('Enter a valid email address').transform(value => value.toLowerCase()),
});
exports.ORGANIZATION_PHONE_ERROR = 'Enter a valid Philippine telephone number.';
/** Nine national landline digits: area 2 + eight digits, or a provincial area + seven. */
function normalizeOrganizationPhone(value) {
    let national = value.trim();
    if (national.length > exports.ORGANIZATION_FIELD_LIMITS.phone)
        return null;
    if (national.startsWith('+63'))
        national = national.slice(3).trim();
    if (!/^(?:0?\d{9}|\(0?\d{2}\) ?\d{3}[ -]?\d{4}|(?:\(0?2\)|0?2)[ -]?\d{4}[ -]?\d{4}|0?\d{2}[ -]\d{3}[ -]?\d{4})$/.test(national))
        return null;
    let digits = national.replace(/[ ()-]/g, '');
    if (digits.startsWith('0'))
        digits = digits.slice(1);
    if (!/^(?:2[3-8]\d{7}|(?:3[2-8]|4[2-9]|5[2-6]|6[2-58]|7[24578]|8[2-8])\d{7})$/.test(digits))
        return null;
    return `+63${digits}`;
}
/** Preserve malformed saved values for correction instead of silently clearing them. */
function formatOrganizationPhone(value) {
    const normalized = normalizeOrganizationPhone(value);
    if (!normalized)
        return value.replace(/^\+63\s*/, '');
    const digits = normalized.slice(3);
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 5)}-${digits.slice(5)}`;
}
const organizationPhone = optionalText(exports.ORGANIZATION_FIELD_LIMITS.phone, exports.ORGANIZATION_FIELD_LIMIT_ERRORS.phone).transform((value, context) => {
    if (value == null)
        return value;
    const normalized = normalizeOrganizationPhone(value);
    if (!normalized) {
        context.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: exports.ORGANIZATION_PHONE_ERROR });
        return zod_1.z.NEVER;
    }
    return normalized;
});
exports.UpdateOrganizationSettingsSchema = zod_1.z.object({
    name: exports.OrganizationRequiredFieldsSchema.shape.name.optional(),
    industry: optionalText(exports.ORGANIZATION_FIELD_LIMITS.industry, exports.ORGANIZATION_FIELD_LIMIT_ERRORS.industry).pipe(zod_1.z.enum(company_industries_1.COMPANY_INDUSTRIES, { errorMap: () => ({ message: 'Select a supported industry' }) }).nullable().optional()),
    email: exports.OrganizationRequiredFieldsSchema.shape.email.optional(),
    phone: organizationPhone,
    domain: optionalText(exports.ORGANIZATION_FIELD_LIMITS.domain, exports.ORGANIZATION_FIELD_LIMIT_ERRORS.domain).transform(value => value?.toLowerCase() ?? value)
        .refine(value => value == null || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value), 'Enter a valid domain, such as camxian.com'),
    address: zod_1.z.string().refine(value => value === '' || value.trim().length > 0, 'Office address cannot contain only whitespace')
        .pipe(text(exports.ORGANIZATION_FIELD_LIMITS.address, true, exports.ORGANIZATION_FIELD_LIMIT_ERRORS.address)).nullable().optional().transform(value => value === '' ? null : value),
}).strict().refine(value => Object.values(value).some(field => field !== undefined), 'No organization changes supplied');
