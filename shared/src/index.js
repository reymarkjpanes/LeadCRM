"use strict";
// @leadcrm/shared — single source of truth for types, RBAC constants,
// API contracts, and validation schemas.
// Import from here in both frontend and backend — never duplicate.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./types"), exports);
__exportStar(require("./constants"), exports);
__exportStar(require("./contracts"), exports);
__exportStar(require("./validation"), exports);
__exportStar(require("./contracts/auth.contract"), exports);
__exportStar(require("./constants/onboarding"), exports);
__exportStar(require("./validation/auth.schema"), exports);
__exportStar(require("./contracts/profile.contract"), exports);
__exportStar(require("./contracts/record-sort"), exports);
__exportStar(require("./contracts/lead-column-migration"), exports);
__exportStar(require("./validation/administration-user.schema"), exports);
__exportStar(require("./validation/deal-import.schema"), exports);
