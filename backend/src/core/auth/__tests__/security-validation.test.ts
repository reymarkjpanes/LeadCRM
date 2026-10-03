import { expect, it } from 'vitest';
import { EmployeeEmailSchema, StrongPasswordSchema } from '@leadcrm/shared';
it('normalizes employee email and rejects suffix, subdomain, malformed, and control-character bypasses', () => {
  expect(EmployeeEmailSchema.parse(' Employee@CAMXIAN.COM ')).toBe('employee@camxian.com');
  for (const email of ['employee@gmail.com', 'employee@fakecamxian.com', 'employee@camxian.com.attacker.net', 'employee@sub.camxian.com', 'a@b@camxian.com', '\nemployee@camxian.com']) expect(EmployeeEmailSchema.safeParse(email).success).toBe(false);
});
it('preserves spaces and symbols and enforces bcrypt byte limits', () => {
  const password = '  Camxian2026!  ';
  expect(StrongPasswordSchema.parse(password)).toBe(password);
  expect(StrongPasswordSchema.safeParse('Aa1!' + 'é'.repeat(35)).success).toBe(false);
  expect(StrongPasswordSchema.safeParse('Aa1!' + 'x'.repeat(68)).success).toBe(true);
});
