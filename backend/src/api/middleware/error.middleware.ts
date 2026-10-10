import { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodIssue } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if ('type' in err && err.type === 'entity.too.large') {
    res.status(413).json({ success: false, error: 'Request body is too large.' });
    return;
  }
  // Log internally — never expose internals to client.
  // Include Prisma-specific fields when available so production logs are debuggable.
  const errAsUnknown = err as unknown as Record<string, unknown>;
  const prismaCode = errAsUnknown.code as string | undefined;
  const prismaMeta = errAsUnknown.meta as Record<string, unknown> | undefined;
  const importRequest = /\/crm\/(leads|contacts|accounts|deals)\/imports(?:\/|$)/.test(req.path);
  const recoveryRequest = /\/auth\/(forgot-password|reset-password)(?:\/|$)/.test(req.path);
  const sensitiveRequest = importRequest || recoveryRequest;

  console.error('[Error]', {
    name: err.name,
    message: importRequest ? 'CRM import request failed' : recoveryRequest ? 'Password recovery request failed' : err.message,
    ...(prismaCode !== undefined && { code: prismaCode }),
    ...(!sensitiveRequest && prismaMeta !== undefined && { meta: prismaMeta }),
    path: req.path,
    method: req.method,
    stack: !sensitiveRequest && process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  if (err instanceof AppError) {
    if (err.retryAt) res.setHeader('Retry-After', String(Math.max(1, Math.ceil((Date.parse(err.retryAt) - Date.now()) / 1000))));
    res.status(err.statusCode).json({
      success: false,
      error: err.code ? { code: err.code, message: err.message, ...(err.retryAt ? { retryAt: err.retryAt } : {}) } : err.message,
    });
    return;
  }

  // Shared CommonJS contracts and ESM consumers can load distinct Zod classes.
  // Recognize their validated issue shape as well as the local constructor.
  const issues = errAsUnknown.issues;
  const validationError = err instanceof ZodError ? err :
    err.name === 'ZodError' && Array.isArray(issues) && issues.every(issue =>
      issue && typeof issue.code === 'string' && typeof issue.message === 'string' &&
      Array.isArray(issue.path) && issue.path.every((part: unknown) => typeof part === 'string' || typeof part === 'number'))
      ? new ZodError(issues as ZodIssue[]) : null;
  if (validationError) {
    res.status(400).json({
      success: false,
      error: validationError.issues[0]?.message ?? 'Validation failed',
      fieldErrors: validationError.flatten().fieldErrors,
    });
    return;
  }

  // ── Prisma error handling ──────────────────────────────────────────────────
  // Convert Prisma errors to structured AppError responses.
  // Raw Prisma internals (SQL, column names, stack traces) are NEVER sent to client.

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      // Record not found
      res.status(404).json({
        success: false,
        error: { code: 'P2025', message: 'Record not found' },
      });
      return;
    }
    if (err.code === 'P2002') {
      // Unique constraint violation
      res.status(409).json({
        success: false,
        error: { code: 'P2002', message: 'A record with this value already exists' },
      });
      return;
    }
    // All other known Prisma errors (e.g. P2022 schema drift, P2003 FK violation)
    res.status(500).json({
      success: false,
      error: { code: err.code, message: 'Database operation failed — please contact support' },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({
      success: false,
      error: { code: 'PRISMA_VALIDATION', message: 'Invalid data supplied to database operation' },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    res.status(503).json({
      success: false,
      error: { code: 'DB_UNAVAILABLE', message: 'Database connection failed — please try again shortly' },
    });
    return;
  }

  // Generic fallback — never expose stack traces to client
  res.status(500).json({
    success: false,
    error: 'An unexpected error occurred. Please try again.',
  });
}
