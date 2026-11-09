export function getNameDigitError(field: string | undefined, value: unknown): string | undefined {
  if (typeof value !== 'string' || !/[0-9]/.test(value)) return;
  if (field === 'firstName') return 'First name must not contain numbers.';
  if (field === 'lastName') return 'Last name must not contain numbers.';
}
