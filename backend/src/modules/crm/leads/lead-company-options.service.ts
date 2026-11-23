import { LeadCompanyOptionsQuerySchema, matchLeadCompanyOptions } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { crmReadWhere, mayReadCrmModule, readLeadCompanyNames } from '../access/crm-record-access.service';

export async function getLeadCompanyOptions(tenantId: string, query: unknown) {
  const { search, source } = LeadCompanyOptionsQuerySchema.parse(query);
  const accountsAllowed = source !== 'leads' && await mayReadCrmModule(prisma, tenantId, 'accounts');
  const [accounts, leadCompanies] = await Promise.all([
    accountsAllowed ? prisma.account.findMany({
      where: {
        tenantId, isArchived: false, deletedAt: null,
        AND: [await crmReadWhere(prisma, tenantId, 'accounts', 'all'), ...buildSearchClauses(search, ['name'])],
      },
      select: { id: true, name: true, industry: true, address: true },
    }) : [],
    source === 'accounts' ? [] : readLeadCompanyNames(prisma, tenantId, search),
  ]);
  return matchLeadCompanyOptions(accounts, leadCompanies, search);
}
