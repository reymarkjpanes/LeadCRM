"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductInterestConfigSchema = exports.ProductInterestPatchSchema = exports.ProductInterestIdSchema = exports.ProductInterestCreateSchema = exports.ProductInterestSchema = exports.ProductCategoryMutationSchema = exports.ProductCategoryNameSchema = exports.StoredProductCategoryNameSchema = exports.PRODUCT_INTEREST_NAME_MAX_ERROR = exports.MAX_ACTIVE_PRODUCTS = exports.PRODUCT_CATEGORY_MAX_LENGTH = exports.PRODUCT_DESCRIPTION_MAX_LENGTH = exports.PRODUCT_INTEREST_NAME_MAX_LENGTH = exports.PRODUCT_DEAL_VALUE_NEGATIVE_ERROR = exports.PRODUCT_DEAL_VALUE_DIGITS_ERROR = exports.PRODUCT_DEAL_VALUE_REQUIRED_ERROR = void 0;
exports.parseProductAmount = parseProductAmount;
exports.isProductCreateAmountInput = isProductCreateAmountInput;
exports.parseProductCreateAmount = parseProductCreateAmount;
exports.withProductOptions = withProductOptions;
const zod_1 = require("zod");
const text_length_1 = require("../validation/text-length");
/** Accept display currency only at the form boundary; API money remains numeric. */
function parseProductAmount(input) {
    const text = input.trim().replace(/^₱\s*/, '');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))
        return null;
    const amount = Number(text.replace(/,/g, ''));
    return Number.isFinite(amount) ? amount : null;
}
/** Allow raw monetary input, including empty and trailing-decimal typing states. */
function isProductCreateAmountInput(input) {
    return /^(?:\d+(?:\.\d{0,2})?)?$/.test(input);
}
function parseProductCreateAmount(input) {
    return isProductCreateAmountInput(input) ? parseProductAmount(input) : null;
}
exports.PRODUCT_DEAL_VALUE_REQUIRED_ERROR = 'Deal value is required.';
exports.PRODUCT_DEAL_VALUE_DIGITS_ERROR = 'Deal value must contain digits only.';
exports.PRODUCT_DEAL_VALUE_NEGATIVE_ERROR = 'Deal value must not be negative.';
exports.PRODUCT_INTEREST_NAME_MAX_LENGTH = 200;
exports.PRODUCT_DESCRIPTION_MAX_LENGTH = 1000;
exports.PRODUCT_CATEGORY_MAX_LENGTH = 100;
exports.MAX_ACTIVE_PRODUCTS = 100;
exports.PRODUCT_INTEREST_NAME_MAX_ERROR = `Product name must not exceed ${exports.PRODUCT_INTEREST_NAME_MAX_LENGTH} characters.`;
const productNameSchema = zod_1.z.string().trim().min(1, 'Product name is required').max(exports.PRODUCT_INTEREST_NAME_MAX_LENGTH, exports.PRODUCT_INTEREST_NAME_MAX_ERROR)
    .refine(v => !/[\u0000-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed');
const categoryName = zod_1.z.string().trim().min(1, 'Category is required.');
exports.StoredProductCategoryNameSchema = categoryName.max(200)
    .refine(v => !/[\u0000-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed.');
exports.ProductCategoryNameSchema = categoryName.max(exports.PRODUCT_CATEGORY_MAX_LENGTH, (0, text_length_1.maxLengthMessage)('Category name', exports.PRODUCT_CATEGORY_MAX_LENGTH))
    .refine(v => !/[\u0000-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed.');
exports.ProductCategoryMutationSchema = zod_1.z.discriminatedUnion('action', [
    zod_1.z.object({ action: zod_1.z.literal('add'), name: exports.ProductCategoryNameSchema }).strict(),
    zod_1.z.object({ action: zod_1.z.literal('rename'), name: exports.StoredProductCategoryNameSchema, newName: exports.ProductCategoryNameSchema }).strict(),
    zod_1.z.object({ action: zod_1.z.literal('delete'), name: exports.StoredProductCategoryNameSchema }).strict(),
]);
exports.ProductInterestSchema = zod_1.z.object({
    name: productNameSchema,
    category: exports.ProductCategoryNameSchema,
    description: zod_1.z.string().trim().max(exports.PRODUCT_DESCRIPTION_MAX_LENGTH, (0, text_length_1.maxLengthMessage)('Product description', exports.PRODUCT_DESCRIPTION_MAX_LENGTH)).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v), 'Control characters are not allowed.').default(''),
    dealValue: zod_1.z.number().finite().min(0).max(999999999999).multipleOf(0.01),
}).strict();
exports.ProductInterestCreateSchema = exports.ProductInterestSchema.extend({
    dealValue: zod_1.z.number({ required_error: exports.PRODUCT_DEAL_VALUE_REQUIRED_ERROR, invalid_type_error: exports.PRODUCT_DEAL_VALUE_DIGITS_ERROR })
        .finite().min(0, exports.PRODUCT_DEAL_VALUE_NEGATIVE_ERROR)
        .max(999999999999).multipleOf(0.01),
});
exports.ProductInterestIdSchema = zod_1.z.string().uuid();
exports.ProductInterestPatchSchema = exports.ProductInterestSchema.partial().refine(v => Object.keys(v).length > 0, 'Provide product changes.');
exports.ProductInterestConfigSchema = zod_1.z.array(exports.ProductInterestSchema).max(exports.MAX_ACTIVE_PRODUCTS).refine(rows => new Set(rows.map(row => row.name.toLowerCase())).size === rows.length, 'Product names must be unique');
function withProductOptions(fields, products) {
    return fields.map(field => field.mapToField === 'productInterest' ? { ...field, options: products.map(p => p.id), optionLabels: Object.fromEntries(products.map(p => [p.id, p.name])) } : field);
}
