"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_TEMPLATES = void 0;
const permission_modules_1 = require("./permission-modules");
const permissions = (modules, edit = false) => Object.fromEntries(permission_modules_1.PERMISSION_MODULES.filter(m => modules.includes(m.key)).map(m => [m.key, { ...permission_modules_1.EMPTY_PERMISSION_FLAGS, canView: true, canCreate: edit && m.actions.includes('canCreate'), canEdit: edit && m.actions.includes('canEdit') }]));
exports.ROLE_TEMPLATES = [
    { key: 'sales-manager', name: 'Sales Manager', description: 'CRM editing. Pipeline configuration and other privileged actions require explicit grants.', permissions: permissions(['dashboard', 'leads', 'contacts', 'accounts', 'deals', 'tasks'], true) },
    { key: 'sales-representative', name: 'Sales Representative', description: 'CRM read and write access.', permissions: permissions(['dashboard', 'leads', 'contacts', 'accounts', 'deals', 'tasks'], true) },
    { key: 'viewer', name: 'Viewer', description: 'Read-only CRM access.', permissions: permissions(['dashboard', 'leads', 'contacts', 'accounts', 'deals', 'tasks']) },
];
