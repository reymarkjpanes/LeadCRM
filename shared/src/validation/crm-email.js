"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrmEmailSchema = void 0;
const zod_1 = require("zod");
/** Shared manual Lead/Contact create and field-edit validation. */
exports.CrmEmailSchema = zod_1.z.string().trim().min(1, 'Email is required').max(254, 'Email must be 254 characters or less').email('Invalid email address');
