import type { z } from 'zod';

export function textFieldError(schema: z.ZodTypeAny, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

export function omitUnchangedText<T extends object>(values: T, saved: Partial<T> | undefined, fields: (keyof T)[]): T {
  if (!saved) return values;
  const changes = { ...values };
  for (const field of fields) {
    if ((values[field] ?? '') === (saved[field] ?? '')) delete changes[field];
  }
  return changes;
}
