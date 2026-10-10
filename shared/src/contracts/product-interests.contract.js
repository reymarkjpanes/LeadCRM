"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductInterestConfigSchema = exports.ProductInterestPatchSchema = exports.ProductInterestIdSchema = exports.ProductInterestCreateSchema = exports.ProductInterestSchema = exports.PRODUCT_INTEREST_NAME_MAX_ERROR = exports.PRODUCT_INTEREST_NAME_MAX_LENGTH = exports.PRODUCT_DEAL_VALUE_NEGATIVE_ERROR = exports.PRODUCT_DEAL_VALUE_DIGITS_ERROR = exports.PRODUCT_DEAL_VALUE_REQUIRED_ERROR = void 0;
exports.parseProductAmount = parseProductAmount;
exports.isProductCreateAmountInput = isProductCreateAmountInput;
exports.parseProductCreateAmount = parseProductCreateAmount;
exports.withProductOptions = withProductOptions;
const zod_1 = require("zod");
/** Accept display currency only at the form boundary; API money remains numeric. */
function parseProductAmount(input) {
    const text = input.trim().replace(/^₱\s*/, '');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))
        return null;
    const amount = Number(text.replace(/,/g, ''));
    return Number.isFinite(amount) ? amount : null;
}
/** New catalog entries accept whole digit-only amounts in the raw form value. */
function isProductCreateAmountInput(input) {
    return /^\d*$/.test(input);
}
function parseProductCreateAmount(input) {
    if (input.length === 0 || !isProductCreateAmountInput(input))
        return null;
    const amount = Number(input);
    return Number.isFinite(amount) ? amount : null;
}
exports.PRODUCT_DEAL_VALUE_REQUIRED_ERROR = 'Deal value is required.';
exports.PRODUCT_DEAL_VALUE_DIGITS_ERROR = 'Deal value must contain digits only.';
exports.PRODUCT_DEAL_VALUE_NEGATIVE_ERROR = 'Deal value must not be negative.';
exports.PRODUCT_INTEREST_NAME_MAX_LENGTH = 200;
exports.PRODUCT_INTEREST_NAME_MAX_ERROR = `Product name must not exceed ${exports.PRODUCT_INTEREST_NAME_MAX_LENGTH} characters.`;
const productNameSchema = zod_1.z.string().trim().min(1, 'Product name is required').max(exports.PRODUCT_INTEREST_NAME_MAX_LENGTH, exports.PRODUCT_INTEREST_NAME_MAX_ERROR)
    .refine(v => !/[\u0000-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed');
exports.ProductInterestSchema = zod_1.z.object({
    name: productNameSchema,
    dealValue: zod_1.z.number().finite().min(0).max(999999999999).multipleOf(0.01),
}).strict();
exports.ProductInterestCreateSchema = exports.ProductInterestSchema.extend({
    dealValue: zod_1.z.number({ required_error: exports.PRODUCT_DEAL_VALUE_REQUIRED_ERROR, invalid_type_error: exports.PRODUCT_DEAL_VALUE_DIGITS_ERROR })
        .finite().int(exports.PRODUCT_DEAL_VALUE_DIGITS_ERROR).min(0, exports.PRODUCT_DEAL_VALUE_NEGATIVE_ERROR)
        .max(999999999999),
});
exports.ProductInterestIdSchema = zod_1.z.string().uuid();
exports.ProductInterestPatchSchema = exports.ProductInterestSchema.partial().refine(v => Object.keys(v).length > 0, 'Provide a name or Deal value');
exports.ProductInterestConfigSchema = zod_1.z.array(exports.ProductInterestSchema).max(100).refine(rows => new Set(rows.map(row => row.name.toLowerCase())).size === rows.length, 'Product names must be unique');
function withProductOptions(fields, products) {
    return fields.map(field => field.mapToField === 'productInterest' ? { ...field, options: products.map(p => p.id), optionLabels: Object.fromEntries(products.map(p => [p.id, p.name])) } : field);
}
