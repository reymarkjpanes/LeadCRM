import { z } from 'zod';

export const UpgradePlanSchema = z.object({
  plan: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
  billingCycle: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']),
});

export type UpgradePlanInput = z.infer<typeof UpgradePlanSchema>;
