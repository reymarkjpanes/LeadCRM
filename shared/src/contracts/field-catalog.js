"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRM_SYSTEM_FIELDS = exports.defaultFieldGroupId = exports.FieldLayoutActionSchema = exports.FieldLayoutSchema = exports.NativeFieldOverrideSchema = exports.FieldGroupSchema = void 0;
exports.getCrmFieldCatalog = getCrmFieldCatalog;
exports.defaultFieldLayout = defaultFieldLayout;
exports.upgradeAssignmentLayout = upgradeAssignmentLayout;
exports.resolveCrmField = resolveCrmField;
const account_retirement_1 = require("./account-retirement");
const zod_1 = require("zod");
const custom_field_identity_1 = require("./custom-field-identity");
const company_industries_1 = require("../constants/company-industries");
const record_experience_1 = require("./record-experience");
const closing_requirements_1 = require("./closing-requirements");
exports.FieldGroupSchema = zod_1.z.object({ id: zod_1.z.string().min(1).max(100), label: zod_1.z.string().trim().min(1).max(100), order: zod_1.z.number().int().min(0).max(100000), protected: zod_1.z.boolean().optional() }).strict();
exports.NativeFieldOverrideSchema = zod_1.z.object({ label: zod_1.z.string().trim().min(1).max(100), groupId: zod_1.z.string().min(1).max(100), order: zod_1.z.number().int().min(0).max(100000), visibleInForm: zod_1.z.boolean(), visibleInDetails: zod_1.z.boolean() }).strict();
exports.FieldLayoutSchema = zod_1.z.object({ version: zod_1.z.literal(1), revision: zod_1.z.number().int().nonnegative().optional(), module: zod_1.z.enum(closing_requirements_1.CUSTOM_FIELD_MODULES), groups: zod_1.z.array(exports.FieldGroupSchema).min(1).max(100), fields: zod_1.z.record(zod_1.z.string(), exports.NativeFieldOverrideSchema) }).strict();
const layoutRevision = zod_1.z.number().int().nonnegative();
exports.FieldLayoutActionSchema = zod_1.z.discriminatedUnion('action', [
    zod_1.z.object({ action: zod_1.z.literal('add'), label: zod_1.z.string().trim().min(1).max(100), expectedRevision: layoutRevision.optional() }).strict(),
    zod_1.z.object({ action: zod_1.z.literal('rename'), groupId: zod_1.z.string(), label: zod_1.z.string().trim().min(1).max(100), expectedRevision: layoutRevision.optional() }).strict(),
    zod_1.z.object({ action: zod_1.z.literal('moveGroup'), groupId: zod_1.z.string(), direction: zod_1.z.enum(['up', 'down']), expectedRevision: layoutRevision.optional() }).strict(),
    zod_1.z.object({ action: zod_1.z.literal('delete'), groupId: zod_1.z.string(), moveToGroupId: zod_1.z.string().optional(), expectedRevision: layoutRevision.optional() }).strict(),
    zod_1.z.object({ action: zod_1.z.literal('field'), technicalKey: zod_1.z.string(), label: zod_1.z.string().trim().min(1).max(100).optional(), groupId: zod_1.z.string().optional(), visibleInForm: zod_1.z.boolean().optional(), visibleInDetails: zod_1.z.boolean().optional(), direction: zod_1.z.enum(['up', 'down']).optional(), expectedRevision: layoutRevision.optional() }).strict(),
    zod_1.z.object({ action: zod_1.z.literal('reorderGroups'), groupIds: zod_1.z.array(zod_1.z.string().min(1)).min(1).max(100), expectedRevision: layoutRevision }).strict(),
    zod_1.z.object({ action: zod_1.z.literal('reorderFields'), groupId: zod_1.z.string().min(1), technicalKeys: zod_1.z.array(zod_1.z.string().min(1)).min(1).max(200), expectedRevision: layoutRevision }).strict(),
]);
const defaultFieldGroupId = (module, label) => {
    if (module === 'accounts')
        return { 'basic information': 'accounts:section:0', address: 'accounts:section:1', notes: 'accounts:section:4', 'additional information': account_retirement_1.ACCOUNT_ADDITIONAL_GROUP_ID }[(0, closing_requirements_1.customFieldNameKey)(label)] ?? 'accounts:additional-information';
    const legacyContactGroup = module === 'contacts' ? { 'status & classification': 1, relationships: 2 }[(0, closing_requirements_1.customFieldNameKey)(label)] : undefined;
    return module === 'deals' && (0, closing_requirements_1.customFieldNameKey)(label) === 'closed won requirements' ? closing_requirements_1.CLOSED_WON_GROUP_ID : `${module}:section:${legacyContactGroup ?? closing_requirements_1.CUSTOM_FIELD_BUILT_IN_GROUPS[module].findIndex(group => (0, closing_requirements_1.customFieldNameKey)(group) === (0, closing_requirements_1.customFieldNameKey)(label))}`;
};
exports.defaultFieldGroupId = defaultFieldGroupId;
const person = [['firstName', 'First Name', 'text', 0, true], ['lastName', 'Last Name', 'text', 0, true], ['email', 'Email', 'text', 0, true], ['phone', 'Phone', 'text', 0], ['status', 'Status', 'dropdown', 1, false, record_experience_1.CRM_STATUSES], ['productInterestIds', 'Product Interest', 'products', 1], ['source', 'Lead Source', 'dropdown', 3, false, record_experience_1.LEAD_SOURCES], ['assignedUserId', 'Assigned Agent', 'reference', 4, false, undefined, 'user'], ['address', 'Full Address', 'longText', 3]];
const native = {
    leads: [...person, ['companyName', 'Company Name', 'text', 2], ['accountId', 'Account', 'reference', 2, false, undefined, 'account']],
    contacts: [...person, ['companyName', 'Company', 'text', 2], ['accountId', 'Account', 'reference', 2, false, undefined, 'account'], ['notes', 'Notes', 'longText', 3]],
    accounts: [['name', 'Account Name', 'text', 0, true], ['industry', 'Industry', 'dropdown', 0, false, company_industries_1.COMPANY_INDUSTRIES], ['size', 'Company Size', 'dropdown', 0, false, record_experience_1.COMPANY_SIZE_OPTIONS], ['website', 'Website', 'text', 0], ['address', 'Full Address', 'longText', 1]],
    deals: [['title', 'Title', 'text', 0, true], ['value', 'Deal Value', 'number', 0], ['productInterestIds', 'Product Interest', 'products', 0, true], ['pipelineId', 'Pipeline', 'reference', 0, true, undefined, 'pipeline'], ['stageId', 'Stage', 'reference', 0, true, undefined, 'stage'], ['priority', 'Priority', 'dropdown', 0, false, ['LOW', 'MEDIUM', 'HIGH']], ['expectedCloseDate', 'Expected Close Date', 'date', 2], ['assignedUserId', 'Assigned Agent', 'reference', 4, false, undefined, 'user'], ['accountId', 'Account', 'reference', 1, false, undefined, 'account'], ['leadSource', 'Lead Source', 'dropdown', 2, false, record_experience_1.LEAD_SOURCES], ['industry', 'Industry', 'dropdown', 2, false, company_industries_1.COMPANY_INDUSTRIES], ['address', 'Address', 'longText', 2]],
};
exports.CRM_SYSTEM_FIELDS = Object.fromEntries(closing_requirements_1.CUSTOM_FIELD_MODULES.map(module => [module, [...native[module], ['createdAt', 'Created', 'date', 0]].map(([technicalKey, label, type, groupIndex, mandatory = false, options, reference], order) => ({ technicalKey, label: module === 'contacts' && technicalKey === 'source' ? 'Source' : label, module, kind: 'System', type, groupId: (0, exports.defaultFieldGroupId)(module, closing_requirements_1.CUSTOM_FIELD_BUILT_IN_GROUPS[module][groupIndex]), group: closing_requirements_1.CUSTOM_FIELD_BUILT_IN_GROUPS[module][groupIndex], order, required: mandatory, mandatory, active: true, visibleInForm: !['value', 'createdAt'].includes(technicalKey), visibleInDetails: true, conditionAvailable: true, personalizationAvailable: true, ...(options ? { options } : {}), ...(reference ? { reference } : {}) }))]));
/** Explicit supported business keys only: never infer fields from database properties. */
function getCrmFieldCatalog(module, definitions = [], layout) {
    const groups = layout?.groups ?? defaultFieldLayout(module).groups;
    const standard = exports.CRM_SYSTEM_FIELDS[module].map(field => {
        const override = layout?.fields[field.technicalKey];
        const resolved = { ...field, ...(override ? { ...override, label: override.label } : {}) };
        if (module === 'accounts' && field.technicalKey === 'address' && resolved.label === 'Street Address')
            resolved.label = 'Full Address';
        return { ...resolved, group: groups.find(group => group.id === resolved.groupId)?.label ?? field.group };
    });
    const custom = definitions.map(closing_requirements_1.normalizeCustomField).filter(field => field.module === module && !field.deletedAt).map((field) => {
        const groupId = module === 'accounts' && (account_retirement_1.ACCOUNT_RETIRED_GROUP_IDS.includes(field.groupId ?? '') || !field.groupId && ['Assigned Agent', 'Relationships', 'Products & Interests', 'Notes'].includes(field.group)) ? (0, account_retirement_1.accountAdditionalGroupId)(groups) : field.groupId ?? groups.find(group => (0, closing_requirements_1.customFieldNameKey)(group.label) === (0, closing_requirements_1.customFieldNameKey)(field.group))?.id ?? (0, exports.defaultFieldGroupId)(module, field.group);
        return { technicalKey: (0, custom_field_identity_1.customFieldTechnicalKey)(field), canonicalTechnicalKey: `customFieldValues.${field.id}`, customFieldId: field.id, label: field.name, module, kind: (0, closing_requirements_1.isSystemClosingField)(field) ? 'System' : 'Custom', type: field.type === 'Text' ? 'text' : field.type === 'Long Text' ? 'longText' : field.type === 'Number' ? 'number' : field.type === 'Date' ? 'date' : field.type === 'Dropdown' ? 'dropdown' : 'file', groupId, group: groups.find(group => group.id === groupId)?.label ?? field.group, order: field.order, required: field.required, mandatory: false, active: field.active, visibleInForm: field.visibleInForm, visibleInDetails: field.visibleInDetails, conditionAvailable: field.active && !(0, closing_requirements_1.isClosedWonField)(field), personalizationAvailable: field.active && field.type !== 'File Upload' && !(0, closing_requirements_1.isClosedWonField)(field), options: field.options, ...(field.type === 'File Upload' ? { unavailableReason: 'Private files support presence conditions only; file links cannot be personalized.' } : {}) };
    });
    return [...standard, ...custom].sort((a, b) => (groups.find(group => group.id === a.groupId)?.order ?? 100000) - (groups.find(group => group.id === b.groupId)?.order ?? 100000) || a.order - b.order || a.technicalKey.localeCompare(b.technicalKey));
}
function defaultFieldLayout(module) {
    return { version: 1, module, groups: closing_requirements_1.CUSTOM_FIELD_BUILT_IN_GROUPS[module].map((label, order) => ({ id: (0, exports.defaultFieldGroupId)(module, label), label, order, ...(module === 'deals' && order === 3 ? { protected: true } : {}) })), fields: {} };
}
/** Upgrade only untouched built-in assignment defaults, identified by stable IDs. */
function upgradeAssignmentLayout(layout, definitions = []) {
    const next = structuredClone((0, account_retirement_1.upgradeAccountFieldLayout)(layout));
    const module = layout.module;
    if (module === 'leads' || module === 'contacts') {
        const company = next.fields.companyName;
        if (company?.groupId === `${module}:section:0`)
            company.groupId = `${module}:section:2`;
    }
    if (module === 'accounts')
        for (const key of ['city', 'province', 'country'])
            delete next.fields[key];
    if (layout.fields.assignedUserId || layout.module !== 'accounts' && layout.groups.some(group => group.id === layout.module + ':section:4'))
        return next;
    const sourceIndex = module === 'deals' ? 1 : module === 'leads' ? 3 : 2;
    const sourceLabel = module === 'leads' ? 'Additional Information' : 'Relationships';
    const source = next.groups.find(group => group.id === module + ':section:' + sourceIndex);
    const preservePlacement = () => {
        const field = exports.CRM_SYSTEM_FIELDS[module].find(field => field.technicalKey === 'assignedUserId');
        if (source && module !== 'accounts')
            next.fields.assignedUserId = { label: field.label, groupId: source.id, order: field.order, visibleInForm: true, visibleInDetails: true };
        return next;
    };
    if (!source || source.label !== sourceLabel || source.order !== sourceIndex)
        return preservePlacement();
    if (module === 'accounts') {
        // Custom fields keep their administrator's section title and placement.
        if (definitions.some(field => field.module === module && (field.groupId === source.id || !field.groupId && field.group === sourceLabel)))
            return next;
        source.label = 'Assigned Agent';
    }
    else {
        const targetId = module + ':section:4';
        if (!next.groups.some(group => group.id === targetId)) {
            if (next.groups.length >= 100 || next.groups.some(group => group.label === 'Assigned Agent'))
                return preservePlacement();
            next.groups.push({ id: targetId, label: 'Assigned Agent', order: Math.max(...next.groups.map(group => group.order)) + 1 });
        }
    }
    return next;
}
function resolveCrmField(module, key, layout) { return getCrmFieldCatalog(module, [], layout).find(field => field.technicalKey === key); }
