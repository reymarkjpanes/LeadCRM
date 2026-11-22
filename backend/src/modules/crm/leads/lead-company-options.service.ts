import { LeadCompanyOptionsQuerySchema, matchLeadCompanyOptions } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { buildSearchClauses } from '../../../shared/helpers/search';
import { crmReadWhere, mayReadCrmModule } from '../access/crm-record-access.service';

export async function getLeadCompanyOptions(tenantId: string, query: unknown) {
  const { search, source } = LeadCompanyOptionsQuerySchema.parse(query);
  const accountsAllowed = source !== 'leads' && await mayReadCrmModule(prisma, tenantId, 'accounts');
  const leadsAllowed = source !== 'accounts' && await mayReadCrmModule(prisma, tenantId, 'leads');
  const [accounts, leads] = await Promise.all([
    accountsAllowed ? prisma.account.findMany({
      where: {
        tenantId, isArchived: false, deletedAt: null,
        AND: [await crmReadWhere(prisma, tenantId, 'accounts', 'all'), ...buildSearchClauses(search, ['name'])],
      },
      select: { id: true, name: true, industry: true, address: true },
    }) : [],
    leadsAllowed ? prisma.lead.groupBy({
      by: ['companyName'],
      where: {
        tenantId, isArchived: false, deletedAt: null, convertedAt: null, status: { not: 'Merged' },
        accountId: null, companyFromAccount: false, companyName: { not: null },
        AND: [await crmReadWhere(prisma, tenantId, 'leads'), ...buildSearchClauses(search, ['companyName'])],
      },
    }) : [],
  ]);
  return matchLeadCompanyOptions(accounts, leads.flatMap(({ companyName }) => companyName ? [companyName] : []), search);
}
