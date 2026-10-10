"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PH_MOBILE_LENGTH = exports.PH_MOBILE_ERROR = void 0;
exports.isPhMobileInput = isPhMobileInput;
exports.isValidPhMobile = isValidPhMobile;
exports.validatePhMobile = validatePhMobile;
exports.toE164 = toE164;
/** Canonical Philippine mobile number rules shared by CRM and profile forms. */
exports.PH_MOBILE_ERROR = 'Enter a valid 10-digit Philippine mobile number starting with 9.';
exports.PH_MOBILE_LENGTH = 10;
/** Allows editable prefixes while enforcing digits-only input and the exact cap. */
function isPhMobileInput(value) {
    return /^\d*$/.test(value) && value.length <= exports.PH_MOBILE_LENGTH;
}
/** A national mobile number without the country prefix, in 9XXXXXXXXX form. */
function isValidPhMobile(value) {
    return value.length === exports.PH_MOBILE_LENGTH && value.startsWith('9') && isPhMobileInput(value);
}
/** Returns an inline validation message, or null when valid or optional-empty. */
function validatePhMobile(value) {
    if (value.length === 0)
        return null;
    return isValidPhMobile(value) ? null : exports.PH_MOBILE_ERROR;
}
/** Converts a validated local number to LeadCRM's existing E.164 storage format. */
function toE164(localNumber) {
    return `+63${localNumber}`;
}
