import type { Prisma } from '@prisma/client';
import type { CrmImportModule } from '@leadcrm/shared';
import { importModules } from './import-modules';

type JobCreate = { createdById: string; fileName: string; totalRecords: number; idempotencyKey: string; requestHash: string; status: string; uploadId?: string };
type JobUpdate = { successfulRecords: number; failedRecords: number; duplicateRecords: number; status: string; completedAt: Date | null };
type RowWrite = { importId: string; rowNumber: number; status: string; remarks?: string; data: Prisma.InputJsonObject; entityId?: string };
export type ImportQuery = { page: number; limit: number; status?: string };
const createdBy = { select: { id: true, firstName: true, lastName: true } } as const;

/** Every query carries explicit module/scope, even outside request middleware. */
export function importStore(db: Prisma.TransactionClient, routeModule: CrmImportModule, tenantId: string) {
  const scope = { tenantId, module: importModules[routeModule] };
  const rowsWhere = (importJobId: string, status?: string) => ({ importJobId, status, job: scope });
  return {
    find: (id: string) => db.crmImportJob.findFirst({ where: { ...scope, id }, include: { createdBy } }),
    findKey: (idempotencyKey: string) => db.crmImportJob.findFirst({ where: { ...scope, idempotencyKey } }),
    create: (data: JobCreate) => db.crmImportJob.create({ data: { ...data, ...scope } }),
    update: (id: string, data: JobUpdate) => db.crmImportJob.update({ where: { ...scope, id }, data }),
    list: (q: ImportQuery) => db.crmImportJob.findMany({ where: { ...scope, status: q.status }, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { createdBy } }),
    count: (status?: string) => db.crmImportJob.count({ where: { ...scope, status } }),
    row: (importId: string, rowNumber: number) => db.crmImportRowResult.findFirst({ where: { ...rowsWhere(importId), rowNumber } }),
    rows: (importId: string) => db.crmImportRowResult.findMany({ where: rowsWhere(importId), select: { rowNumber: true, status: true } }),
    results: (importId: string, q: ImportQuery) => db.crmImportRowResult.findMany({ where: rowsWhere(importId, q.status), skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { rowNumber: 'asc' } }),
    countResults: (importId: string, status?: string) => db.crmImportRowResult.count({ where: rowsWhere(importId, status) }),
    save: ({ importId, entityId, ...data }: RowWrite) => db.crmImportJob.update({
      where: { ...scope, id: importId }, data: { results: { create: { ...data, recordId: entityId } } },
    }),
  };
}
