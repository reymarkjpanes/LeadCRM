"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESSIBLE_WORKSPACE_STATUSES = void 0;
exports.isWorkspaceAccessible = isWorkspaceAccessible;
/** Only live workspaces may authenticate or process customer data. */
exports.ACCESSIBLE_WORKSPACE_STATUSES = ['ACTIVE', 'SANDBOX'];
function isWorkspaceAccessible(status) {
    return exports.ACCESSIBLE_WORKSPACE_STATUSES.some(allowed => allowed === status);
}
