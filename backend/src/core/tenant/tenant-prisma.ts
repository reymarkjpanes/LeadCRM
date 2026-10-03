import { Prisma, PrismaClient } from '@prisma/client';
import { tenantContext } from './tenant-context';
import { tenantModels, tenantChildren } from './tenant-models';
import { AppError } from '../../shared/errors/app-error';

type Args = Record<string, any>;
const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));

export function scopeWhere(model: string, where: Args = {}): Args {
  const scope = tenantContext.getStore();
  if (!scope) return where;
  if (tenantModels.has(model)) return { ...where, ...scope };
  const child = tenantChildren[model];
  if (child) return { ...where, AND: [where.AND ?? {}, { [child.relation]: scope }] };
  if (model === 'AuditLog') return { ...where, tenantId: scope.tenantId };
  return where;
}

/** Prisma middleware does not visit nested operations, so visit relations explicitly. */
function scopeSelection(model: string, args: Args): void {
  for (const selection of [args.include, args.select]) {
    if (!selection || typeof selection !== 'object') continue;
    for (const field of models.get(model)?.fields ?? []) {
      if (field.kind !== 'object' || !selection[field.name]) continue;
      const nested = selection[field.name] === true ? {} : selection[field.name];
      if (field.isList) nested.where = scopeWhere(field.type, nested.where);
      scopeSelection(field.type, nested);
      selection[field.name] = nested;
    }
    if (selection._count) {
      const counts = selection._count === true
        ? Object.fromEntries((models.get(model)?.fields ?? []).filter(f => f.kind === 'object' && f.isList).map(f => [f.name, true]))
        : selection._count.select;
      for (const field of models.get(model)?.fields ?? []) {
        if (!counts?.[field.name] || field.kind !== 'object') continue;
        const count = counts[field.name] === true ? {} : counts[field.name];
        counts[field.name] = { ...count, where: scopeWhere(field.type, count.where) };
      }
      selection._count = { select: counts };
    }
  }
}

function scopeData(model: string, data: Args, create: boolean): void {
  const scope = tenantContext.getStore()!;
  if (tenantModels.has(model)) {
    if (!create && ('tenantId' in data || 'tenant' in data)) {
      throw new AppError('Record tenant cannot be changed.', 400);
    }
    if (create && !data.tenant) data.tenantId = scope.tenantId;
    if (create && data.tenant) data.tenant = { connect: { id: scope.tenantId } };
  }
  for (const field of models.get(model)?.fields ?? []) {
    const nested = data[field.name];
    if (field.kind !== 'object' || !nested) continue;
    for (const operation of ['connect', 'set', 'disconnect', 'delete']) {
      if (!nested[operation] || typeof nested[operation] === 'boolean') continue;
      nested[operation] = Array.isArray(nested[operation])
        ? nested[operation].map((where: Args) => scopeWhere(field.type, where))
        : scopeWhere(field.type, nested[operation]);
    }
    // Shared identity parents must not be used to mutate operational collections.
    if (!tenantModels.has(model) && (tenantModels.has(field.type) || tenantChildren[field.type])) {
      throw new AppError('Change CRM records through their CRM endpoints.', 400);
    }
    for (const action of ['create', 'update', 'upsert', 'connectOrCreate', 'createMany', 'updateMany']) {
      if (!nested[action]) continue;
      const entries = Array.isArray(nested[action]) ? nested[action] : [nested[action]];
      for (const entry of entries) {
        if (action === 'upsert' || action === 'connectOrCreate') {
          entry.where = scopeWhere(field.type, entry.where);
          scopeData(field.type, entry.create, true);
          if (entry.update) scopeData(field.type, entry.update, false);
        } else if (action === 'createMany') {
          for (const row of Array.isArray(entry.data) ? entry.data : [entry.data]) scopeData(field.type, row, true);
        } else {
          if (entry.where) entry.where = scopeWhere(field.type, entry.where);
          scopeData(field.type, entry.data ?? entry, action === 'create');
        }
      }
    }
  }
}

export function installTenantScoping(prisma: PrismaClient): void {
  prisma.$use(async (params, next) => {
    if (!tenantContext.getStore()) return next(params); // platform operations / explicit background discovery
    if (!params.model) throw new AppError('Raw database operations are not allowed in CRM requests.', 403);
    const model = params.model;
    params.args ??= {};
    const args = params.args;
    if (!['create', 'createMany'].includes(params.action)) args.where = scopeWhere(model, args.where);
    scopeSelection(model, args);
    if (args.data) {
      for (const row of Array.isArray(args.data) ? args.data : [args.data]) {
        scopeData(model, row, params.action === 'create' || params.action === 'createMany');
      }
    }
    if (params.action === 'upsert') {
      scopeData(model, args.create, true);
      scopeData(model, args.update, false);
    }
    // Child-only tables inherit scope from their parent, without redundant columns.
    const child = tenantChildren[model];
    if (child && (args.data || args.create || args.update)) {
      const relation = models.get(model)!.fields.find(f => f.name === child.relation)!;
      const fk = relation.relationFromFields![0];
      const rows = [args.data, args.create, args.update].filter(Boolean).flat();
      const checkedParents = new Set<string>();
      for (const row of rows) {
        const id = row[fk] ?? row[child.relation]?.connect?.id;
        if (id && !checkedParents.has(id)) {
          const delegate = (prisma as any)[child.model[0].toLowerCase() + child.model.slice(1)];
          if (!await delegate.findFirst({ where: { id }, select: { id: true } })) throw new AppError('CRM parent not found.', 404);
          checkedParents.add(id);
        }
      }
    }
    return next(params);
  });
}
