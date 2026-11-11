import { expect, it } from 'vitest';
import { getNameDigitError } from './name-digit-error';

it.each([
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['fullName', 'Full name'],
])('validates numbers and special characters by default for %s', (field, label) => {
  expect(getNameDigitError(field, 'John123')).toBe(`${label} must not contain numbers.`);
  expect(getNameDigitError(field, 'John@')).toBe(`${label} must not contain special characters.`);
  expect(getNameDigitError(field, 'John@', false)).toBeUndefined();
  expect(getNameDigitError(field, 'John@', true)).toBe(`${label} must not contain special characters.`);
  expect(getNameDigitError(field, 'John1@', true)).toBe(`${label} must not contain numbers.`);
  expect(getNameDigitError(field, undefined, true)).toBeUndefined();
});

it.each(['John', 'Dela Cruz', "O'Connor", 'Anne-Marie', 'María', 'Mari\u0301a', '李', 'अर्जुन', 'O‘Connor', 'O’Connor', 'Anne‐Marie', 'Anne‑Marie'])('accepts legitimate name %s', value => {
  for (const field of ['firstName', 'lastName', 'fullName']) expect(getNameDigitError(field, value)).toBeUndefined();
});

it.each(['@', '#', '$', '%', '&', '*', '!', '_', '.', '/', '+', '=', '😀', '\t', '\n'])('rejects unsupported name character %s', symbol => {
  expect(getNameDigitError('firstName', `John${symbol}`)).toBe('First name must not contain special characters.');
  expect(getNameDigitError('lastName', `Smith${symbol}1`)).toBe('Last name must not contain numbers.');
});

it('ignores unrelated fields even when special-character validation is enabled', () => {
  expect(getNameDigitError('companyName', 'Company@123', true)).toBeUndefined();
  expect(getNameDigitError(undefined, 'John@123', true)).toBeUndefined();
});
