/** Canonical Philippine mobile number rules shared by CRM and profile forms. */
export const PH_MOBILE_ERROR = 'Enter a valid 10-digit Philippine mobile number starting with 9.';
export const PH_MOBILE_LENGTH = 10;

/** Allows editable prefixes while enforcing digits-only input and the exact cap. */
export function isPhMobileInput(value: string): boolean {
  return /^\d*$/.test(value) && value.length <= PH_MOBILE_LENGTH;
}

/** A national mobile number without the country prefix, in 9XXXXXXXXX form. */
export function isValidPhMobile(value: string): boolean {
  return value.length === PH_MOBILE_LENGTH && value.startsWith('9') && isPhMobileInput(value);
}

/** Returns an inline validation message, or null when valid or optional-empty. */
export function validatePhMobile(value: string): string | null {
  if (value.length === 0) return null;
  return isValidPhMobile(value) ? null : PH_MOBILE_ERROR;
}

/** Converts a validated local number to LeadCRM's existing E.164 storage format. */
export function toE164(localNumber: string): string {
  return `+63${localNumber}`;
}
