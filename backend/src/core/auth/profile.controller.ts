import type { Request, Response, NextFunction } from 'express';
import { updateSelfProfile, uploadSelfAvatar, readSelfAvatar } from './profile.service';
import { requestProfileEmailChange, confirmProfileEmailChange } from './profile-email.service';
import { AUTH_COOKIE_NAME, loginCookieOptions } from './auth-session';

export async function patchProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await updateSelfProfile(req.user!.userId, req.user!.tenantId, req.body);
    res.json({ success: true, data: { user } });
  } catch (error) { next(error); }
}

export async function requestEmailChange(req: Request, res: Response, next: NextFunction) {
  try {
    await requestProfileEmailChange({ ...req.user!, sessionId: req.authSession!.sessionId }, req.body);
    res.set('Cache-Control', 'no-store').json({ success: true });
  } catch (error) { next(error); }
}

export async function confirmEmailChange(req: Request, res: Response, next: NextFunction) {
  try {
    await confirmProfileEmailChange({ ...req.user!, sessionId: req.authSession!.sessionId }, req.body);
    res.clearCookie(AUTH_COOKIE_NAME, loginCookieOptions());
    res.set('Cache-Control', 'no-store').json({ success: true });
  } catch (error) { next(error); }
}
export async function uploadAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await uploadSelfAvatar(req.user!.userId, req.user!.tenantId, req.body, req.get('Content-Type')?.split(';')[0] ?? '');
    res.json({ success: true, data: { user } });
  } catch (error) { next(error); }
}
export async function getAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    const bytes = await readSelfAvatar(req.user!.userId, req.user!.tenantId, String(req.params.avatarId));
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(bytes);
  } catch (error) { next(error); }
}
