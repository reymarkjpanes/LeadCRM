"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USERS_TABLE_COLUMNS = exports.WORKFLOWS_TABLE_COLUMNS = exports.CAMPAIGNS_TABLE_COLUMNS = void 0;
exports.normalizeModuleColumns = normalizeModuleColumns;
const lead_column_migration_1 = require("./lead-column-migration");
/** Preserve saved visibility/order when an existing table column is renamed. */
function normalizeModuleColumns(module, columns) {
    if (module === 'leads')
        return (0, lead_column_migration_1.normalizeLeadColumns)(columns);
    if (module !== 'users' || !columns.some(column => column.id === 'department'))
        return columns;
    const hasGroups = columns.some(column => column.id === 'groups');
    return columns.flatMap(column => column.id !== 'department' ? [column]
        : hasGroups ? [] : [{ ...column, id: 'groups' }]);
}
function defineColumns(group, entries) {
    return entries.map(([id, label], defaultOrder) => ({ id, label, defaultOrder, group,
        required: id === 'name', defaultVisible: true, priority: id === 'name' ? 'required' : 'low' }));
}
exports.CAMPAIGNS_TABLE_COLUMNS = defineColumns('Campaigns', [
    ['name', 'Campaign'], ['type', 'Type'], ['status', 'Status'], ['target', 'Target'],
    ['submitted', 'Submitted'], ['opened', 'Opened'], ['clicked', 'Clicked'], ['engagement', 'Engagement'], ['createdAt', 'Created'],
]);
exports.WORKFLOWS_TABLE_COLUMNS = defineColumns('Workflows', [
    ['name', 'Name'], ['trigger', 'Trigger'], ['status', 'Status'], ['lastRun', 'Last run'], ['runs', 'Runs'], ['actions', 'Actions'],
]);
exports.USERS_TABLE_COLUMNS = defineColumns('Users', [
    ['name', 'User'], ['role', 'Role'], ['email', 'Contact'], ['status', 'Status'], ['groups', 'Groups'], ['activity', 'Actions'],
]);
