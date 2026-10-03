"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateOrganizationSettingsSchema = exports.ORGANIZATION_PHONE_ERROR = void 0;
exports.normalizeOrganizationPhone = normalizeOrganizationPhone;
exports.formatOrganizationPhone = formatOrganizationPhone;
const zod_1 = require("zod");
const optionalText = zod_1.z.string().trim().nullable().optional()
    .transform(value => value === '' ? null : value);
exports.ORGANIZATION_PHONE_ERROR = 'Enter a valid Philippine telephone number.';
/** Nine national landline digits: area 2 + eight digits, or a provincial area + seven. */
function normalizeOrganizationPhone(value) {
    let national = value.trim();
    if (national.startsWith('+63'))
        national = national.slice(3).trim();
    if (!/^(?:\(\d{1,3}\)|\d+)(?:[ -]?\d+)*$/.test(national))
        return null;
    let digits = national.replace(/[ ()-]/g, '');
    if (digits.startsWith('0'))
        digits = digits.slice(1);
    if (!/^[2-8]\d{8}$/.test(digits))
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
const organizationPhone = optionalText.transform((value, context) => {
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
    name: zod_1.z.string().trim().min(1, 'Organization name is required').max(255).optional(),
    industry: optionalText,
    email: optionalText.pipe(zod_1.z.string().email('Enter a valid email address').nullable().optional()),
    phone: organizationPhone,
    domain: optionalText,
    address: optionalText,
}).strict().refine(value => Object.values(value).some(field => field !== undefined), 'No organization changes supplied');
