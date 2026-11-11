import { expect, it } from 'vitest';
import { getNameDigitError } from './name-digit-error';

it.each([
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
])('preserves digit-only validation by default for %s', (field, label) => {
  expect(getNameDigitError(field, 'John123')).toBe(`${label} must not contain numbers.`);
  expect(getNameDigitError(field, 'John@')).toBeUndefined();
  expect(getNameDigitError(field, 'John@', true)).toBe(`${label} must not contain special characters.`);
  expect(getNameDigitError(field, 'John1@', true)).toBe(`${label} must not contain numbers.`);
  expect(getNameDigitError(field, undefined, true)).toBeUndefined();
});

it('ignores unrelated fields even when special-character validation is enabled', () => {
  expect(getNameDigitError('companyName', 'Company@123', true)).toBeUndefined();
  expect(getNameDigitError(undefined, 'John@123', true)).toBeUndefined();
});
