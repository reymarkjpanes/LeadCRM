"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateDealBatchSchema = exports.DealIndustrySchema = void 0;
exports.productDealTitle = productDealTitle;
const zod_1 = require("zod");
const closing_requirements_1 = require("./closing-requirements");
const company_industries_1 = require("../constants/company-industries");
const product_interests_contract_1 = require("./product-interests.contract");
exports.DealIndustrySchema = zod_1.z.enum(company_industries_1.COMPANY_INDUSTRIES);
const text = (max) => zod_1.z.string().trim().max(max).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Unsupported control characters.');
const id = zod_1.z.string().min(1);
exports.CreateDealBatchSchema = zod_1.z.object({
    customFieldValues: closing_requirements_1.CustomFieldValuesSchema.optional(),
    idempotencyKey: zod_1.z.string().uuid(),
    pipelineId: id,
    stageId: id,
    title: text(255).refine(value => !!value && !/[\r\n\t]/.test(value), 'Enter a valid title.'),
    productInterestIds: zod_1.z.array(product_interests_contract_1.ProductInterestIdSchema).min(1, 'Select at least one Product Interest.').max(100).transform(ids => [...new Set(ids)]),
    priority: zod_1.z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
    expectedCloseDate: zod_1.z.string().datetime().optional(),
    accountId: id.optional(), assignedUserId: id.optional(),
    contactIds: zod_1.z.array(id).max(100).optional(), leadIds: zod_1.z.array(id).max(100).optional(),
    leadSource: text(255).optional(), industry: exports.DealIndustrySchema.optional(), address: text(10000).optional(),
    productInterestOther: text(1000).nullable().optional(),
}).strict();
function productDealTitle(title, product, multiple) {
    if (!multiple)
        return title;
    const suffix = ` — ${product}`;
    return `${title.slice(0, Math.max(1, 255 - suffix.length)).trimEnd()}${suffix}`;
}
