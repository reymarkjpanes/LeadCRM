import { z } from 'zod';
import { EmployeeEmailSchema } from './security.schema';

/** Recovery uses login normalization without revealing account-access restrictions. */
export const ForgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Valid email required'),
}).strict();
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const StrongPasswordSchema = z.string().min(8, 'Use at least 8 characters.').max(72, 'Use no more than 72 characters.').refine(value => new TextEncoder().encode(value).length <= 72, 'Password must be no more than 72 bytes.').refine(value =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s])/.test(value),
  'Use uppercase and lowercase letters, a number, and a special character',
);

export const ChangePasswordSchema = z.object({ password: StrongPasswordSchema }).strict();
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const RegisterSchema = z.object({
  firstName: z.string().trim().min(2, 'First name is required').max(100),
  lastName: z.string().trim().min(2, 'Last name is required').max(100),
  email: EmployeeEmailSchema,
  password: StrongPasswordSchema,
  acceptTerms: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.acceptTerms !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['acceptTerms'],
      message: 'You must accept the terms and conditions',
    });
  }
});

const WebsiteSchema = z.string().trim().max(2048).url('Enter a valid website URL')
  .refine(value => /^https?:\/\//i.test(value), 'Use an http or https website');

export const CompanySetupSchema = z.object({
  companyName: z.string().trim().min(2, 'Company name is required').max(100),
  industry: z.string().trim().min(1, 'Industry is required').max(100),
  companySize: z.string().trim().min(1, 'Company size is required').max(20),
  website: WebsiteSchema.or(z.literal('')).optional(),
});

export const OnboardingProgressSchema = z.object({
  expectedStep: z.number().int().min(0).max(2),
  step: z.number().int().min(0).max(2),
}).refine(data => Math.abs(data.step - data.expectedStep) === 1, {
  message: 'Move one onboarding step at a time',
  path: ['step'],
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type CompanySetupInput = z.infer<typeof CompanySetupSchema>;
export type OnboardingProgressInput = z.infer<typeof OnboardingProgressSchema>;
