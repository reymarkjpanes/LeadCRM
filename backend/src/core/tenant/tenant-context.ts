import { AsyncLocalStorage } from 'node:async_hooks';

/** Authenticated tenant for the lifetime of a CRM request or background job. */
export const tenantContext = new AsyncLocalStorage<{ tenantId: string }>();
