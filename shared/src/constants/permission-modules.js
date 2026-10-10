"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSION_GROUPS = exports.PERMISSION_MODULES = exports.EMPTY_PERMISSION_FLAGS = exports.PERMISSION_ACTIONS = exports.PERMISSION_ACTION_LABELS = exports.PERMISSION_ACTION_KEYS = void 0;
exports.permissionLabel = permissionLabel;
exports.isApplicablePermission = isApplicablePermission;
exports.hasModulePermission = hasModulePermission;
exports.permissionKeys = permissionKeys;
exports.togglePermissionSelection = togglePermissionSelection;
/** Canonical actions; there are no implicit edit-to-privileged-action aliases. */
exports.PERMISSION_ACTION_KEYS = {
    "canView": "view",
    "canCreate": "create",
    "canEdit": "edit",
    "canDelete": "delete",
    "canArchive": "archive",
    "canImport": "import",
    "canManageStages": "manage_stages",
    "canComplete": "complete",
    "canAssign": "assign",
    "canSend": "send",
    "canDuplicate": "duplicate",
    "canViewReports": "view_reports",
    "canActivate": "activate",
    "canViewRuns": "view_runs",
    "canPublish": "publish",
    "canViewSubmissions": "view_submissions",
    "canViewClosedWon": "view_closed_won",
    "canDisable": "disable",
    "canRestore": "restore"
};
exports.PERMISSION_ACTION_LABELS = {
    "canView": "View",
    "canCreate": "Create",
    "canEdit": "Edit",
    "canDelete": "Delete",
    "canArchive": "Archive",
    "canImport": "Import",
    "canManageStages": "Manage Pipeline Stages",
    "canComplete": "Complete",
    "canAssign": "Assign",
    "canSend": "Send",
    "canDuplicate": "Duplicate",
    "canViewReports": "View Campaign Reports",
    "canActivate": "Activate / Pause",
    "canViewRuns": "View Workflow Runs",
    "canPublish": "Publish / Unpublish",
    "canViewSubmissions": "View Form Submissions",
    "canViewClosedWon": "View Product Closed-Won Records",
    "canDisable": "Disable",
    "canRestore": "Restore"
};
exports.PERMISSION_ACTIONS = Object.keys(exports.PERMISSION_ACTION_KEYS);
exports.EMPTY_PERMISSION_FLAGS = {
    "canView": false,
    "canCreate": false,
    "canEdit": false,
    "canDelete": false,
    "canArchive": false,
    "canImport": false,
    "canManageStages": false,
    "canComplete": false,
    "canAssign": false,
    "canSend": false,
    "canDuplicate": false,
    "canViewReports": false,
    "canActivate": false,
    "canViewRuns": false,
    "canPublish": false,
    "canViewSubmissions": false,
    "canViewClosedWon": false,
    "canDisable": false,
    "canRestore": false
};
exports.PERMISSION_MODULES = [
    {
        "key": "dashboard",
        "label": "Dashboard",
        "actions": [
            "canView"
        ]
    },
    {
        "key": "leads",
        "label": "Leads",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canArchive",
            "canImport"
        ]
    },
    {
        "key": "contacts",
        "label": "Contacts",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canArchive",
            "canImport"
        ]
    },
    {
        "key": "accounts",
        "label": "Accounts",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canArchive",
            "canImport"
        ]
    },
    {
        "key": "deals",
        "label": "Deals",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canArchive",
            "canManageStages"
        ]
    },
    {
        "key": "tasks",
        "label": "Tasks",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canComplete",
            "canArchive",
            "canAssign"
        ]
    },
    {
        "key": "campaigns",
        "label": "Campaigns",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canSend",
            "canDuplicate",
            "canArchive",
            "canViewReports"
        ]
    },
    {
        "key": "workflows",
        "label": "Workflows",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canActivate",
            "canDuplicate",
            "canArchive",
            "canViewRuns"
        ]
    },
    {
        "key": "forms",
        "label": "Forms",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canPublish",
            "canDuplicate",
            "canDelete",
            "canViewSubmissions"
        ]
    },
    {
        "key": "products",
        "label": "Products",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canArchive",
            "canViewClosedWon"
        ]
    },
    {
        "key": "custom_fields",
        "label": "Custom Fields",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canDisable"
        ]
    },
    {
        "key": "archived_data",
        "label": "Archived Data",
        "actions": [
            "canView",
            "canRestore"
        ]
    },
    {
        "key": "users",
        "label": "Users",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canActivate",
            "canArchive"
        ]
    },
    {
        "key": "groups",
        "label": "Groups",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canDelete"
        ]
    },
    {
        "key": "roles",
        "label": "Roles",
        "actions": [
            "canView",
            "canCreate",
            "canEdit",
            "canArchive",
            "canAssign"
        ]
    },
    {
        "key": "settings",
        "label": "Organization Settings",
        "actions": [
            "canView",
            "canEdit"
        ]
    }
];
/** Team users and groups share a card, but never share authorization grants. */
exports.PERMISSION_GROUPS = [
    { id: 'dashboard', label: 'Dashboard', modules: ["dashboard"], description: '' },
    { id: 'leads', label: 'Leads', modules: ["leads"], description: '' },
    { id: 'contacts', label: 'Contacts', modules: ["contacts"], description: '' },
    { id: 'accounts', label: 'Accounts', modules: ["accounts"], description: '' },
    { id: 'deals', label: 'Deals', modules: ["deals"], description: '' },
    { id: 'tasks', label: 'Tasks', modules: ["tasks"], description: '' },
    { id: 'campaigns', label: 'Campaigns', modules: ["campaigns"], description: '' },
    { id: 'workflows', label: 'Workflows', modules: ["workflows"], description: '' },
    { id: 'forms', label: 'Forms', modules: ["forms"], description: '' },
    { id: 'products', label: 'Products', modules: ["products"], description: '' },
    { id: 'custom_fields', label: 'Custom Fields', modules: ["custom_fields"], description: '' },
    { id: 'archived_data', label: 'Archived Data', modules: ["archived_data"], description: '' },
    { id: 'users', label: 'Team Management', modules: ["users", "groups"], description: '' },
    { id: 'roles', label: 'Roles & Permissions', modules: ["roles"], description: '' },
    { id: 'settings', label: 'Organization Settings', modules: ["settings"], description: '' },
];
function permissionLabel(module, action) {
    if (module.key === 'roles' && action === 'canView')
        return 'View Roles & Permissions';
    if (module.key === 'users' && action === 'canActivate')
        return 'Activate / Deactivate Users';
    if (['canManageStages', 'canViewReports', 'canViewRuns', 'canViewSubmissions', 'canViewClosedWon'].includes(action))
        return exports.PERMISSION_ACTION_LABELS[action];
    return exports.PERMISSION_ACTION_LABELS[action] + ' ' + module.label;
}
function isApplicablePermission(module, action) {
    return exports.PERMISSION_MODULES.some(m => m.key === module && m.actions.includes(action));
}
/** All actions require their own module's View grant, including secondary views. */
function hasModulePermission(permissions, module, action) {
    return isApplicablePermission(module, action) && permissions[module]?.canView === true && permissions[module]?.[action] === true;
}
function permissionKeys(permissions) {
    return exports.PERMISSION_MODULES.flatMap(module => module.actions.filter(action => hasModulePermission(permissions, module.key, action)).map(action => module.key + '.' + exports.PERMISSION_ACTION_KEYS[action]));
}
function togglePermissionSelection(selected, ids, enabled) {
    const result = new Set(selected);
    for (const id of ids) {
        const [module, action] = id.split('.');
        if (!isApplicablePermission(module, action))
            continue;
        if (enabled) {
            result.add(id);
            result.add(module + '.canView');
        }
        else if (action === 'canView') {
            for (const value of result)
                if (value.startsWith(module + '.'))
                    result.delete(value);
        }
        else
            result.delete(id);
    }
    return [...result];
}
