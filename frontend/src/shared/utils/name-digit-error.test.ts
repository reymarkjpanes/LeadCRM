import { expect, it } from 'vitest';
import { getNameDigitError } from './name-digit-error';

const invalidName = 'must not contain numbers or special characters such as @, #, $, %, &, *, !, _, +, =, /, ?, ., or ().';
const firstNameError = `First name ${invalidName}`;
const lastNameError = `Last name ${invalidName}`;

it.each([
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['fullName', 'Full name'],
])('reports one message for numbers and unsupported symbols in %s', (field, label) => {
  const error = `${label} ${invalidName}`;
  for (const invalid of ['John123', 'John@', 'John123@']) {
    expect(getNameDigitError(field, invalid)).toBe(error);
  }
  expect(getNameDigitError(field, 'John@', false)).toBeUndefined();
  expect(getNameDigitError(field, 'John@', true)).toBe(error);
  expect(getNameDigitError(field, 'John123@', false)).toBe(error);
  expect(getNameDigitError(field, 'John١', false)).toBe(error);
  expect(getNameDigitError(field, undefined, true)).toBeUndefined();
});

it.each(['John', 'Dela Cruz', "O'Connor", 'Anne-Marie', 'María', 'Mari\u0301a', '李', 'अर्जुन', 'O‘Connor', 'O’Connor', 'Anne‐Marie', 'Anne‑Marie'])('accepts legitimate name %s', value => {
  for (const field of ['firstName', 'lastName', 'fullName']) expect(getNameDigitError(field, value)).toBeUndefined();
});

it.each(['@', '#', '$', '%', '&', '*', '!', '_', '.', '/', '+', '=', '?', '(', ')', '😀', '\t', '\n'])('rejects unsupported name character %s', symbol => {
  expect(getNameDigitError('firstName', `John${symbol}`)).toBe(firstNameError);
  expect(getNameDigitError('lastName', `Smith${symbol}1`)).toBe(lastNameError);
});

it('ignores unrelated fields even when special-character validation is enabled', () => {
  expect(getNameDigitError('companyName', 'Company@123', true)).toBeUndefined();
  expect(getNameDigitError(undefined, 'John@123', true)).toBeUndefined();
});
