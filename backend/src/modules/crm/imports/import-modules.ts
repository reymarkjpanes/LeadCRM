import type { CrmImportModule } from '@leadcrm/shared';
import type { CrmImportModule as DbModule } from '@prisma/client';

/** Route names remain plural; persistence has one controlled discriminator. */
export const importModules: Record<CrmImportModule, DbModule> = {
  leads: 'LEAD', contacts: 'CONTACT', accounts: 'ACCOUNT', deals: 'DEAL',
};
