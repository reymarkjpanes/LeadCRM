"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManualCreateDealBatchSchema = exports.CreateDealBatchSchema = exports.DealAssociationChangeSchema = exports.DealAssociationSchema = void 0;
exports.dealAssociationPatch = dealAssociationPatch;
exports.validateManualDealAssociation = validateManualDealAssociation;
exports.productDealTitle = productDealTitle;
const zod_1 = require("zod");
const deal_address_1 = require("./deal-address");
const closing_requirements_1 = require("./closing-requirements");
const product_interests_contract_1 = require("./product-interests.contract");
const text = (max) => zod_1.z.string().trim().max(max).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Unsupported control characters.');
const id = zod_1.z.string().min(1);
exports.DealAssociationSchema = zod_1.z.object({ type: zod_1.z.enum(['lead', 'contact']), id }).strict();
exports.DealAssociationChangeSchema = exports.DealAssociationSchema.extend({ previous: exports.DealAssociationSchema.optional() }).strict();
/** Target the selected junction only; null means its previous link is stale. */
function dealAssociationPatch(leadIds, contactIds, change) {
    if (change.previous && !(change.previous.type === 'lead' ? leadIds : contactIds).includes(change.previous.id))
        return null;
    const remaining = (type, ids) => ids.filter(id => !(change.previous?.type === type && change.previous.id === id));
    const leads = remaining('lead', leadIds), contacts = remaining('contact', contactIds);
    return { leadIds: [...new Set(change.type === 'lead' ? [change.id, ...leads] : leads)], contactIds: [...new Set(change.type === 'contact' ? [change.id, ...contacts] : contacts)] };
}
/** Manual entry points require one person; internal product creation keeps its existing contract. */
function validateManualDealAssociation(data, ctx) {
    if ((data.leadIds?.length ?? 0) + (data.contactIds?.length ?? 0) !== 1) {
        ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, path: ['leadIds'], message: 'Select one Lead or Contact to associate with this Deal.' });
    }
}
exports.CreateDealBatchSchema = zod_1.z.object({
    addressSource: deal_address_1.DealAddressSourceSchema.nullable().optional(),
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
    leadSource: text(255).optional(), address: text(10000).optional(),
    productInterestOther: text(1000).nullable().optional(),
}).strict();
exports.ManualCreateDealBatchSchema = exports.CreateDealBatchSchema.superRefine(validateManualDealAssociation);
function productDealTitle(title, product, multiple) {
    if (!multiple)
        return title;
    const suffix = ` — ${product}`;
    return `${title.slice(0, Math.max(1, 255 - suffix.length)).trimEnd()}${suffix}`;
}
