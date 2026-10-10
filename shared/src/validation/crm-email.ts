import { z } from 'zod';

/** Shared manual Lead/Contact create and field-edit validation. */
export const CrmEmailSchema = z.string().trim().min(1, 'Email is required').max(254, 'Email must be 254 characters or less').email('Invalid email address');
