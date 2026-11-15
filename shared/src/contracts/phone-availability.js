"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneAvailabilitySchema = exports.CrmPhoneAvailabilityQuerySchema = exports.PHONE_AVAILABILITY_MESSAGES = exports.CUSTOMER_PHONE_CONFLICT = exports.STAFF_PHONE_CONFLICT = void 0;
const zod_1 = require("zod");
const lead_contract_1 = require("./lead.contract");
exports.STAFF_PHONE_CONFLICT = 'This phone number belongs to a staff account and cannot be used.';
exports.CUSTOMER_PHONE_CONFLICT = 'This phone number is already registered to another Lead or Contact.';
exports.PHONE_AVAILABILITY_MESSAGES = {
    STAFF_PHONE_NOT_ALLOWED: exports.STAFF_PHONE_CONFLICT,
    CUSTOMER_PHONE_CONFLICT: exports.CUSTOMER_PHONE_CONFLICT,
};
exports.CrmPhoneAvailabilityQuerySchema = zod_1.z.object({
    module: zod_1.z.enum(['leads', 'contacts']),
    phone: lead_contract_1.LeadPhoneSchema,
    excludeId: zod_1.z.string().uuid().optional(),
}).strict();
exports.PhoneAvailabilitySchema = zod_1.z.discriminatedUnion('available', [
    zod_1.z.object({ available: zod_1.z.literal(true) }),
    zod_1.z.object({ available: zod_1.z.literal(false), reason: zod_1.z.enum(['STAFF_PHONE_NOT_ALLOWED', 'CUSTOMER_PHONE_CONFLICT']) }),
]);
