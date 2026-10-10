/**
 * Philippine mobile phone utilities — shared across Lead and Contact forms.
 * All functions are pure with no side effects.
 */
import { toE164, validatePhMobile } from '@leadcrm/shared';
export { toE164, validatePhMobile };

/**
 * Normalizes raw phone input to a bare 10-digit local number.
 * Handles:
 *   +639xxxxxxxxx  → 9xxxxxxxxx
 *   09xxxxxxxxx    → 9xxxxxxxxx
 *   912 345 6789   → 9123456789
 *   912-345-6789   → 9123456789
 *   (912)3456789   → 9123456789
 * Returns at most 10 characters.
 */
export function normalizePhInput(raw: string): string {
  // Strip all non-digit characters first
  let digits = raw.replace(/\D/g, '');

  // Handle +639... (after stripping + becomes 639...)
  if (digits.startsWith('639') && digits.length >= 12) {
    digits = digits.slice(2); // remove '63'
  } else if (digits.startsWith('63') && digits.length >= 11) {
    digits = digits.slice(2); // remove '63'
  }

  // Handle leading zero (09...)
  if (digits.startsWith('0') && digits.length > 1) {
    digits = digits.slice(1);
  }

  // Cap at 10 digits
  return digits.slice(0, 10);
}
