import { RegisterSchema } from './auth.schema';
export { RegisterSchema } from './auth.schema';
export type { RegisterInput } from './auth.schema';
import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const CreateUserSchema = RegisterSchema.innerType()
  .omit({ acceptTerms: true })
  .extend({ role: z.string().min(1, 'Role is required') });

export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
