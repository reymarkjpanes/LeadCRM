import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { csvDocument, DealViewFiltersSchema, matchesDealView, type DealViewFilters } from '@leadcrm/shared';
import prisma from '../../../config/database.config';
import { salesContext } from '../leads/sales-context';
import * as leads from '../contacts/contacts.service';
import * as contacts from '../contacts-v2/contacts-v2.service';
import * as accounts from '../companies/companies.service';
import * as deals from '../deals/deals.service';
import { DealsQuerySchema } from '../deals/deals.dto';
import { presentDealResponse } from '../deals/deal-presentation';
import { AppError } from '../../../shared/errors/app-error';

type Module = 'leads' | 'contacts' | 'accounts' | 'deals';
type Row = Record<string, any>;
const name = (person: Row | null | undefined) => person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : '';
const participants = (row: Row) => (row.contactDeals?.length ? row.contactDeals.map((link: Row) => name(link.contact)) : row.leadDeals?.map((link: Row) => name(link.lead)) ?? []).join('; ');
const columns: Record<Module, Array<[string, (row: Row) => unknown]>> = {
  leads: [['Name', name], ['Email', r => r.email], ['Phone', r => r.phone], ['Company Name', r => r.companyName], ['Status', r => r.status], ['Assigned Agent', r => name(r.assignedUser)], ['Lead Source', r => r.source], ['Full Address', r => r.address], ['Product Interest', r => r.productInterest?.join('; ')], ['Created', r => r.createdAt], ['Updated', r => r.updatedAt]],
  contacts: [['First Name', r => r.firstName], ['Last Name', r => r.lastName], ['Email', r => r.email], ['Phone', r => r.phone], ['Company', r => r.companyName], ['Status', r => r.status], ['Assigned Agent', r => name(r.assignedUser)], ['Product Interest', r => r.productInterests?.join('; ')], ['Created Date', r => r.createdAt], ['Updated', r => r.updatedAt]],
  accounts: [['Account Name', r => r.name], ['Industry', r => r.industry], ['Company Size', r => r.size], ['Full Address', r => r.address], ['Website', r => r.website], ['Tags', r => r.tags?.join('; ')], ['Created Date', r => r.createdAt]],
  deals: [['Deal Name', r => r.title], ['Pipeline', r => r.pipeline?.name], ['Stage', r => r.stage?.name], ['Deal Value', r => r.value], ['Currency', r => r.currency], ['Priority', r => r.priority], ['Company', r => r.organization?.name], ['Contact', participants], ['Assigned Agent', r => name(r.assignedUser)], ['Product Interest', r => r.productInterests?.join('; ')], ['Expected Close Date', r => r.expectedCloseDate], ['Created Date', r => r.createdAt]],
};

export function exportCrm(module: Module) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Internal batching parameters replace, rather than trust, browser pagination.
      const { page: _page, limit: _limit, pageSize: _size, view: rawView, groupByStage: _group, ...query } = req.query;
      let view: DealViewFilters | undefined;
      if (rawView !== undefined) {
        if (module !== 'deals' || typeof rawView !== 'string' || rawView.length > 30000) throw new AppError('Invalid export filters.', 400);
        try { view = DealViewFiltersSchema.parse(JSON.parse(rawView)) as DealViewFilters; } catch { throw new AppError('Invalid export filters.', 400); }
      }
      const at = Date.now();
      const data = await prisma.$transaction(tx => salesContext.run(tx, async () => {
        const rows: Row[] = [];
        for (let page = 1; ; page++) {
          const params = { ...query, currentUserId: req.user!.userId, page, limit: 100 };
          const result = module === 'leads' ? await leads.getContacts(req.user!.tenantId, params)
            : module === 'contacts' ? await contacts.getContacts(req.user!.tenantId, params)
            : module === 'accounts' ? await accounts.getCompanies(req.user!.tenantId, params)
            : await presentDealResponse(req.user!.tenantId, await deals.getDeals(req.user!.tenantId, DealsQuerySchema.parse(params)));
          for (const row of result.data as Row[]) {
            if (view && !matchesDealView({ ...row, title: row.title, stageId: row.stageId, priority: row.priority,
              companyName: row.organization?.name, contactPerson: name(row.contactDeals?.[0]?.contact) || name(row.leadDeals?.[0]?.lead), createdAt: row.createdAt,
              status: row.stage?.isWon ? 'Won' : row.stage?.isLost ? 'Lost' : 'Open',
              leadIds: row.leadDeals?.map((link: Row) => link.leadId ?? link.lead?.id), contactIds: row.contactDeals?.map((link: Row) => link.contactId ?? link.contact?.id),
            }, view, req.user!.userId, at)) continue;
            rows.push(row);
          }
          if (!result.meta.hasMore) break;
        }
        return rows;
      }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
      const fields = columns[module];
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${module}-${date}.csv"`, 'Cache-Control': 'no-store' });
      res.send(csvDocument([fields.map(([label]) => label), ...data.map(row => fields.map(([, value]) => value(row)))]));
    } catch (error) { next(error); }
  };
}
