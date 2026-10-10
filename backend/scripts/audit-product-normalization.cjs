/* Read-only, repeatable preflight. Inventory files contain record IDs/product labels;
 * keep them in ignored private storage. Never logs credentials or customer identities. */
const { PrismaClient, Prisma } = require('@prisma/client');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync, existsSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../.env') });
const db = new PrismaClient();
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
async function audit() {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const migrations = await tx.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name');
    const directory = resolve(__dirname, '../prisma/migrations');
    const migrationFiles = readdirSync(directory).filter(name => existsSync(resolve(directory, name, 'migration.sql'))).map(name => {
      const sql = readFileSync(resolve(directory, name, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = migrations.find(m => m.migration_name === name && m.finished_at && !m.rolled_back_at);
      const variants = [sql, sql.replace(/\r\n/g, '\n'), sql.replace(/\r?\n/g, '\r\n')].map(text => createHash('sha256').update(text).digest('hex'));
      return { name, checksum, applied: !!applied, checksumMatches: applied ? variants.includes(applied.checksum) : null,
        statements: sql.split(';').length - 1 };
    });
    const counts = {};
    for (const model of Prisma.dmmf.datamodel.models) {
      const table = model.dbName || model.name;
      const present = await tx.$queryRawUnsafe('SELECT to_regclass($1)::text AS name', '"' + table + '"');
      if (present[0].name) counts[table] = (await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}"`))[0].n;
    }
    const products = await tx.productInterest.findMany({ orderBy: { id: 'asc' }, select: { id: true, tenantId: true, name: true, dealValue: true, active: true, updatedAt: true } });
    const normalize = value => value.trim().toLowerCase();
    const relationships = {};
    for (const [model, fields] of [['lead', ['productInterestIds', 'productInterest']], ['contact', ['productInterests', 'activeProducts']], ['account', ['productInterests', 'activeProducts']], ['deal', ['productInterestIds', 'productInterests']]]) {
      const rows = await tx[model].findMany({ select: { id: true, tenantId: true, ...Object.fromEntries(fields.map(f => [f, true])), ...(model === 'deal' ? { productInterestId: true, value: true } : {}) } });
      const unresolved = [], ambiguous = [], multiProduct = [];
      let resolvedLinks = 0;
      for (const row of rows) {
        const ids = new Set();
        for (const field of fields) for (const value of row[field]) {
          const matches = products.filter(p => p.tenantId === row.tenantId && (field.endsWith('Ids') ? p.id === value : normalize(p.name) === normalize(value)));
          if (matches.length === 1) ids.add(matches[0].id);
          else (matches.length ? ambiguous : unresolved).push({ id: row.id, field, value });
        }
        if (row.productInterestId) ids.add(row.productInterestId);
        resolvedLinks += ids.size;
        if (model === 'deal' && ids.size > 1) multiProduct.push({ id: row.id, products: [...ids] });
      }
      relationships[model] = { rows: rows.length, resolvedLinks, unresolved, ambiguous, multiProduct };
      if (model === 'deal') {
        relationships.deal.snapshotHash = createHash('sha256').update(json(rows.sort((a,b) => a.id.localeCompare(b.id)))).digest('hex');
        relationships.deal.valueHash = createHash('sha256').update(json(rows.map(({id,value}) => ({id,value})))).digest('hex');
        relationships.deal.withoutResolvedProduct = rows.filter(row => !row.productInterestId && !row.productInterestIds.length && !row.productInterests.length).length;
      }
    }
    const candidates = {};
    const presentTable = async table => (await tx.$queryRawUnsafe('SELECT to_regclass($1)::text AS name', '"' + table + '"'))[0].name;
    for (const [table, stamp] of [['DealAction','performedAt'],['AutomationRule','updatedAt'],['SMSQueue','createdAt'],['EmailVerificationToken','createdAt']]) {
      candidates[table] = await presentTable(table) ? await tx.$queryRawUnsafe(`SELECT count(*)::int AS rows, max("${stamp}") AS latest FROM "${table}"`) : { retired: true };
    }
    if (await presentTable('EmailVerificationToken')) candidates.validVerificationTokens = await tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM "EmailVerificationToken" WHERE "usedAt" IS NULL AND "expiresAt" > now()');
    if (await presentTable('SMSQueue')) candidates.smsStatus = await tx.$queryRawUnsafe('SELECT status,count(*)::int AS n FROM "SMSQueue" GROUP BY status');
    if (await presentTable('AutomationRule')) candidates.activeAutomationRules = await tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM "AutomationRule" WHERE "isActive"');
    const missingLinks = {};
    const orphanLinks = {};
    for (const [parent, target, link] of [['Deal','Lead','LeadDeal'],['Deal','Contact','ContactDeal'],...['Lead','Contact','Deal','Account'].map(t => ['Task',t,'Task'+t])]) {
      const field = target[0].toLowerCase()+target.slice(1)+'Id', parentField = parent.toLowerCase()+'Id';
      const column = await tx.$queryRawUnsafe('SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2', parent, field);
      missingLinks[link] = column.length ? (await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${parent}" p WHERE p."${field}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${link}" l WHERE l."${parentField}"=p.id AND l."${field}"=p."${field}" AND l."tenantId"=p."tenantId")`))[0].n : 'legacy column retired';
      orphanLinks[link] = (await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${link}" l LEFT JOIN "${parent}" p ON p.id=l."${parentField}" AND p."tenantId"=l."tenantId" LEFT JOIN "${target}" r ON r.id=l."${field}" AND r."tenantId"=l."tenantId" WHERE p.id IS NULL OR r.id IS NULL`))[0].n;
    }
    const normalization = {};
    for (const kind of ['Lead','Contact','Account']) {
      const table = kind + 'ProductInterest', field = kind.toLowerCase() + 'Id';
      if (counts[table] !== undefined) orphanLinks[table] = (await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}" l LEFT JOIN "${kind}" r ON r.id=l."${field}" AND r."tenantId"=l."tenantId" LEFT JOIN "ProductInterest" p ON p.id=l."productInterestId" AND p."tenantId"=l."tenantId" WHERE r.id IS NULL OR p.id IS NULL`))[0].n;
      if (counts[table] !== undefined) normalization[kind] = { links: counts[table], ...(await tx.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE "productsNormalized")::int AS normalized, count(*) FILTER (WHERE NOT "productsNormalized")::int AS compatibility FROM "${kind}"`))[0] };
    }
    orphanLinks.DealProduct = (await tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM "Deal" d LEFT JOIN "ProductInterest" p ON p.id=d."productInterestId" AND p."tenantId"=d."tenantId" WHERE d."productInterestId" IS NOT NULL AND p.id IS NULL'))[0].n;
    const candidateForeignKeys = await tx.$queryRawUnsafe(`SELECT conrelid::regclass::text AS table_name, confrelid::regclass::text AS referenced_table, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND (conrelid::regclass::text IN ('"DealAction"','"AutomationRule"','"SMSQueue"','"EmailVerificationToken"') OR confrelid::regclass::text IN ('"DealAction"','"AutomationRule"','"SMSQueue"','"EmailVerificationToken"')) ORDER BY conname`);
    const historicalPriceActions = await tx.$queryRawUnsafe(`SELECT id,"isActive" FROM "Workflow" WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(actions::jsonb) a WHERE a->>'type'='update_field' AND a->'config'->>'field' IN ('value','currency','productInterestIds'))`);
    return { capturedAt: new Date().toISOString(), modelCount: Prisma.dmmf.datamodel.models.length, liveTableCount: Object.keys(counts).length, counts, candidates, candidateForeignKeys, historicalPriceActions, products, relationships, normalization, missingLinks, orphanLinks, migrationFiles,
      unfinishedMigrations: migrations.filter(m => !m.finished_at && !m.rolled_back_at) };
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
}
audit().then(report => {
  const output = process.argv[2];
  if (output) {
    writeFileSync(resolve(output), json(report)+'\n');
    console.log(json({ inventory: resolve(output), liveTables: report.liveTableCount, rows: report.counts, productPrices: { zero: report.products.filter(p => p.dealValue.isZero()).length, nonzero: report.products.filter(p => !p.dealValue.isZero()).length }, missingLinks: report.missingLinks, orphanLinks: report.orphanLinks, migrationDrift: report.migrationFiles.filter(m => m.checksumMatches === false).map(m => m.name), pending: report.migrationFiles.filter(m => !m.applied).map(m => m.name), historicalPriceActions: report.historicalPriceActions.length }));
  } else console.log(json(report));
}).catch(error => { console.error('Audit failed:', error.code || error.name); process.exitCode = 1; }).finally(() => db.$disconnect());
