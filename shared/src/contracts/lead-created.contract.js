"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadCreatedFilterSchema = void 0;
exports.leadCreatedBounds = leadCreatedBounds;
const zod_1 = require("zod");
const date = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
    const parsed = new Date(v + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}, 'Enter a valid calendar date');
exports.LeadCreatedFilterSchema = zod_1.z.discriminatedUnion('operator', [
    zod_1.z.object({ operator: zod_1.z.literal('lte'), date }).strict(),
    zod_1.z.object({ operator: zod_1.z.literal('gte'), date }).strict(),
    zod_1.z.object({ operator: zod_1.z.literal('between'), from: date, to: date }).strict(),
]).refine(v => v.operator !== 'between' || v.from <= v.to, 'From must be on or before To');
/** Camxian calendar days are Asia/Manila (UTC+08:00), independent of browser/server timezone. */
function leadCreatedBounds(filter) {
    const start = (value) => new Date(value + 'T00:00:00.000+08:00');
    const end = (value) => new Date(value + 'T23:59:59.999+08:00');
    if (filter.operator === 'lte')
        return { lte: end(filter.date) };
    if (filter.operator === 'gte')
        return { gte: start(filter.date) };
    return { gte: start(filter.from), lte: end(filter.to) };
}
