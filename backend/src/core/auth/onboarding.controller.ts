import type { Request, Response, NextFunction } from 'express';
import { OnboardingProgressSchema } from '@leadcrm/shared';
import { readAuthUser } from './auth-user';
import * as onboarding from './onboarding.service';

export async function getOnboardingStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId, tenantId } = req.user!;
    res.json({ success: true, data: { user: req.authUser ?? await readAuthUser(userId, tenantId) } });
  } catch (error) { next(error); }
}

export async function updateOnboardingStep(req: Request, res: Response, next: NextFunction) {
  try {
    const input = OnboardingProgressSchema.parse(req.body);
    const user = await onboarding.advanceOnboarding(req.user!, input);
    res.json({ success: true, data: { user } });
  } catch (error) { next(error); }
}

export async function completeOnboarding(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await onboarding.completeOnboarding(req.user!);
    res.json({ success: true, data: { user } });
  } catch (error) { next(error); }
}

// Temporary compatibility routes share the same authorization and final-step rules.
export const saveOnboardingWorkspace = completeOnboarding;
