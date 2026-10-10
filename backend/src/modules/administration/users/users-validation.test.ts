import { expect, it } from 'vitest';
import { CreateUsersSchema } from './users.dto';
const valid = { firstName: ' Juan ', lastName: ' Dela Cruz ', email: ' Juan.Dela_Cruz+sales-2@CAMXIAN.COM ', phone: '9123456789', role: 'Sales', jobTitle: ' Agent ' };
it('normalizes the existing user-creation DTO before persistence', () => {
  expect(CreateUsersSchema.parse(valid)).toMatchObject({ firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan.dela_cruz+sales-2@camxian.com', phone: '+639123456789', jobTitle: 'Agent' });
});
it.each(['juan@gmail.com', 'juan@camxian.com.evil.com', 'juan@sub.camxian.com', 'juan@other@camxian.com', 'juan name@camxian.com', 'juan\u0001@camxian.com'])('rejects invalid email %s at the server DTO', email => {
  expect(CreateUsersSchema.safeParse({ ...valid, email }).success).toBe(false);
});
it.each(['firstName', 'lastName', 'jobTitle'])('rejects control characters and excessive length in %s', field => {
  expect(CreateUsersSchema.safeParse({ ...valid, [field]: 'bad\u0001' }).success).toBe(false);
  expect(CreateUsersSchema.safeParse({ ...valid, [field]: 'a'.repeat(101) }).success).toBe(false);
});
it.each(['8123456789', '912345678', '91234567890', '912345678a'])('preserves PH phone validation for %s', phone => {
  expect(CreateUsersSchema.safeParse({ ...valid, phone }).success).toBe(false);
});
