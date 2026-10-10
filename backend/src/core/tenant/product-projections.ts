import { Prisma, PrismaClient } from '@prisma/client';

const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
const productFields: Record<string, string[]> = {
  Lead: ['productInterest', 'productInterestIds'],
  Contact: ['productInterests', 'activeProducts'], Account: ['productInterests', 'activeProducts'],
  Deal: ['productInterests', 'productInterestIds'],
};
type Args = Record<string, any>;

function cloneSelection(value: any): any {
  if (Array.isArray(value)) return value.map(cloneSelection);
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneSelection(child)]));
  return value;
}

/** Compatibility is at the database boundary so imports, workflows, nested CRM
 * responses and background jobs all see the same canonical catalog names.
 * Legacy rows explicitly blocked by the backfill retain their original arrays.
 * This layer performs no writes and always runs before tenant selection scoping.
 */
function selectProducts(model: string, args: Args): (row: any) => any {
  const fields = productFields[model];
  const wanted = fields?.filter(field => !args.select || args.select[field]) ?? [];
  const extra = new Set<string>();
  const cleanups: Array<(row: any) => void> = [];
  const selection = args.select ?? (args.include ??= {});
  const ensureFields = (selected: Args, names: string[]) => {
    const added = names.filter(name => selected.select && !selected.select[name]);
    for (const name of added) selected.select[name] = true;
    return (row: any) => { for (const name of added) if (row) delete row[name]; };
  };
  if (wanted.length) {
    const add = (key: string, value: unknown) => { if (!selection[key]) { selection[key] = value; extra.add(key); } };
    if (model === 'Deal') {
      add('productInterestRecord', { select: { id: true, name: true } });
      if (!extra.has('productInterestRecord')) {
        const relation = selection.productInterestRecord === true ? {} : selection.productInterestRecord;
        selection.productInterestRecord = relation;
        const clean = ensureFields(relation, ['id', 'name']);
        cleanups.push(row => clean(row.productInterestRecord));
      }
      if (args.select) add('productsNormalized', true);
    } else {
      add('productLinks', { include: { product: { select: { id: true, name: true } } }, orderBy: [{ position: 'asc' }, { productInterestId: 'asc' }] });
      if (!extra.has('productLinks')) {
        const links = selection.productLinks === true ? {} : selection.productLinks;
        selection.productLinks = links;
        const cleanFlags = ensureFields(links, model === 'Lead' ? [] : ['interested', 'activeProduct']);
        const linkFields = links.select ?? (links.include ??= {});
        const addedProduct = !linkFields.product;
        const product = linkFields.product === true ? {} : linkFields.product || { select: { id: true, name: true } };
        linkFields.product = product;
        const cleanProduct = ensureFields(product, ['id', 'name']);
        cleanups.push(row => { for (const link of row.productLinks ?? []) { cleanFlags(link); cleanProduct(link.product); if (addedProduct) delete link.product; } });
      }
      if (args.select) add('productsNormalized', true);
    }
  }
  const children = new Map<string, (row: any) => any>();
  for (const field of models.get(model)?.fields ?? []) {
    if (field.kind !== 'object' || !selection[field.name] || extra.has(field.name)) continue;
    const nested = selection[field.name] === true ? {} : selection[field.name];
    selection[field.name] = nested;
    children.set(field.name, selectProducts(field.type, nested));
  }
  const project = (row: any): any => {
    if (Array.isArray(row)) return row.map(project);
    if (!row || typeof row !== 'object') return row;
    for (const [field, child] of children) if (row[field]) row[field] = child(row[field]);
    if (wanted.length && model === 'Deal' && row.productsNormalized && row.productInterestRecord) {
      if (wanted.includes('productInterests')) row.productInterests = [row.productInterestRecord.name];
      if (wanted.includes('productInterestIds')) row.productInterestIds = [row.productInterestRecord.id];
    } else if (wanted.length && model !== 'Deal' && row.productsNormalized) {
      const links = row.productLinks ?? [];
      if (model === 'Lead') {
        if (wanted.includes('productInterest')) row.productInterest = links.map((link: any) => link.product.name);
        if (wanted.includes('productInterestIds')) row.productInterestIds = links.map((link: any) => link.product.id);
      } else {
        if (wanted.includes('productInterests')) row.productInterests = links.filter((link: any) => link.interested).map((link: any) => link.product.name);
        if (wanted.includes('activeProducts')) row.activeProducts = links.filter((link: any) => link.activeProduct).map((link: any) => link.product.name);
      }
    }
    for (const clean of cleanups) clean(row);
    for (const key of extra) delete row[key];
    if (fields && !args.select?.productsNormalized) delete row.productsNormalized;
    return row;
  };
  return project;
}

export function installProductProjections(prisma: PrismaClient) {
  prisma.$use(async (params, next) => {
    if (!params.model || !['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow', 'create', 'update', 'upsert', 'delete'].includes(params.action)) return next(params);
    // Repositories reuse include constants. Never add tenant-specific filters to them.
    params.args = { ...params.args, ...(params.args?.include ? { include: cloneSelection(params.args.include) } : {}), ...(params.args?.select ? { select: cloneSelection(params.args.select) } : {}) };
    const project = selectProducts(params.model, params.args);
    return project(await next(params));
  });
}
