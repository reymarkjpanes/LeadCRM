"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSuperRole = isSuperRole;
/** Only predefined administrator identities bypass permission flags. */
function isSuperRole(role) {
    return role === 'Client Admin';
}
