"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRM_MODULE_KEYS = exports.CRM_SCOPE_ACTIONS = void 0;
exports.permittedCrmScopes = permittedCrmScopes;
exports.hasCrmRecordAssignmentAccess = hasCrmRecordAssignmentAccess;
exports.canReassignCrmRecord = canReassignCrmRecord;
const permission_modules_1 = require("../constants/permission-modules");
exports.CRM_SCOPE_ACTIONS = { all: 'canViewAll', my: 'canViewMy', active: 'canViewActive' };
exports.CRM_MODULE_KEYS = ['leads', 'contacts', 'accounts', 'deals'];
function permittedCrmScopes(permissions, module) {
    return Object.keys(exports.CRM_SCOPE_ACTIONS).filter(scope => (0, permission_modules_1.hasModulePermission)(permissions, module, exports.CRM_SCOPE_ACTIONS[scope]));
}
function hasCrmRecordAssignmentAccess(policy, record, module, action = 'canEdit') {
    if (!policy || !record || record.tenantId !== policy.tenantId)
        return false;
    if (policy.clientAdmin)
        return true;
    if (module && ['leads', 'contacts', 'deals'].includes(module) && policy.crmTeamUserIds) {
        return !!policy.permissions && (0, permission_modules_1.hasModulePermission)(policy.permissions, module, action) &&
            typeof record.assignedUserId === 'string' && policy.crmTeamUserIds.includes(record.assignedUserId) &&
            permittedCrmScopes(policy.permissions, module).some(scope => scope === 'all' || scope === 'my' && record.assignedUserId === policy.userId ||
                scope === 'active' && ['Inquiry', 'Hot', 'Warm', 'INQUIRY', 'HOT', 'WARM'].includes(String(record.status)) && record.assignedUserId === policy.userId);
    }
    if (!policy.permissions || !module)
        return module === 'accounts' || !policy.assignmentRestricted || record.assignedUserId === policy.userId;
    return (0, permission_modules_1.hasModulePermission)(policy.permissions, module, action) &&
        permittedCrmScopes(policy.permissions, module).some(scope => scope === 'all' || scope === 'my' && record.assignedUserId === policy.userId ||
            scope === 'active' && ['Inquiry', 'Hot', 'Warm', 'INQUIRY', 'HOT', 'WARM'].includes(String(record.status)) && record.assignedUserId === policy.userId) &&
        (module === 'accounts' || !policy.assignmentRestricted || record.assignedUserId === policy.userId);
}
/** Staff reassignment requires current edit access and a saved Group Head assignment. */
function canReassignCrmRecord(policy, record, module) {
    if (!policy)
        return false;
    if (policy.clientAdmin)
        return hasCrmRecordAssignmentAccess(policy, record, module);
    if (['leads', 'contacts', 'deals'].includes(module) && policy.crmTeamUserIds)
        return policy.crmGroupHead === true && hasCrmRecordAssignmentAccess(policy, record, module);
    if (!policy.permissions)
        return !policy.assignmentRestricted && hasCrmRecordAssignmentAccess(policy, record, module);
    return hasCrmRecordAssignmentAccess({ ...policy,
        permissions: policy.assignmentRestricted ? {} : policy.permissions,
    }, record, module);
}
