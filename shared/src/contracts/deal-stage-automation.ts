import { z } from 'zod';

export const DealStageAutomationSchema = z.object({ enabled: z.boolean() }).strict();
export type DealStageAutomation = z.infer<typeof DealStageAutomationSchema>;
