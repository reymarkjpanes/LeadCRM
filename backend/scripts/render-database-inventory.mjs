import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decisions, jsonDecision, arrayDecision, dropped, finalAction } from './database-audit-decisions.mjs';
const root=resolve(import.meta.dirname,'../..');
const folder=resolve(root,'data/outputs/database-audit');
const source=JSON.parse(readFileSync(resolve(folder,'source.json'),'utf8'));
const original=JSON.parse(readFileSync(resolve(folder,'source-before-retirement.json'),'utf8'));
const live=JSON.parse(readFileSync(resolve(folder,'live-before.json'),'utf8'));
const finalPath=['retirement-live-final.json','retirement-live-expanded.json','live-final.json'].find(name=>existsSync(resolve(folder,name)));
const final=finalPath?JSON.parse(readFileSync(resolve(folder,finalPath),'utf8')):live;
const cleanup=existsSync(resolve(folder,'cleanup-result.json'))?JSON.parse(readFileSync(resolve(folder,'cleanup-result.json'),'utf8')):null;
const destination=resolve(root,'docs/database');mkdirSync(destination,{recursive:true});
const esc=value=>String(value??'none').replaceAll('|','\\|').replaceAll('\n',' ');
const link=r=>`[${r.path}:${r.line}](../../${r.path}#L${r.line})`;
const unique=values=>[...new Set(values)];
const names=new Set(source.models.map(m=>m.name));
const allModels=[...source.models,...original.models.filter(m=>dropped.has(m.name))].sort((a,b)=>a.name.localeCompare(b.name));
if(Object.keys(decisions).length!==allModels.length || allModels.some(m=>!decisions[m.name])) throw new Error('Every original and current model requires a decision');
let out='# LeadCRM database inventory and normalization decisions\n\n';
out+=`Audit date: 2026-10-05 (Asia/Manila). Initial catalog: ${live.applicationTableCount} application tables, ${live.physicalTableCount} physical public tables. Current catalog captured ${final.capturedAt}: ${final.applicationTableCount} application tables, ${final.physicalTableCount} physical tables including Prisma bookkeeping, ${source.models.length} Prisma models. ${source.scannedFiles} repository files searched; ${source.migrations.length} forward migration SQL files replayed.\n\n`;
out+='Direct delegate matches establish code locations, not reachability by themselves. Nested access is reviewed with its parent. The four retired tables had no supported runtime consumers in the deployed build; empty post-cleanup tables alone were not used as proof. Final actions below describe the reviewed release; the live ledger states which migration phases have executed. See [report and rollout](normalization-report.md).\n\n';
out+='Categories: A core domain; B junction/relationship; C history/event; D security/auth; E integration; F configuration; G staging; H cache/counter/snapshot; I legacy candidate; J uncertain.\n\n';
out+='## Complete decision table\n\n| Table | Category | Current purpose | Runtime usage | Normalization issue | Final action | Migration | Risk |\n|---|---|---|---|---|---|---|---|\n';
const migrated=new Set(['User','RoleDefinition','RolePermission','UserRole','Session','TenantGroup','TenantGroupMember','Account','Lead','Contact','Pipeline','Stage','Deal','LeadDeal','ContactDeal','Notification','MarketingForm','FormSubmission','Workflow','WorkflowTriggerRecord','WorkflowExecutionRun','WorkflowExecutionStep','EmailAccount','MailboxMessage','EmailDeliveryLog','Activity','CampaignContact','SMSQueue']);
const migrationFor=name=>dropped.has(name)?'84':name==='Task'?'84, 85, 86':['Deal','LeadDeal','ContactDeal'].includes(name)?'83, 85, 86':['TenantPreference','MailboxThreadAssociation'].includes(name)?'85, 86':name==='CampaignContact'?'83, 86':migrated.has(name)?'83':'None';
for(const model of allModels) {const [category,purpose,issue,action,risk]=decisions[model.name];out+=`| ${model.name} | ${category} | ${esc(purpose)} | ${dropped.has(model.name)?'No supported consumer; historical references only':`${model.reads.length} direct reads; ${model.writes.length} direct writes; nested use below`} | ${esc(issue)} | **${finalAction(model.name)}** — ${esc(action)} | ${migrationFor(model.name)} | ${risk} |\n`;}
out+='| _prisma_migrations | F | Migration ledger | Prisma deploy/diff tooling | Infrastructure bookkeeping | KEEP | Prisma managed | HIGH |\n';
const ownership=(model,field)=>{
  if(dropped.has(model.name))return 'DROP — retired table';
  if(field.name==='tenantId')return 'KEEP — scope projection enforced by FK/middleware';
  if(field.name==='id'||field.attributes.includes('@id'))return 'KEEP — row identity';
  if(field.type.startsWith('Json'))return jsonDecision(model.name,field.name).join(': ');
  if(field.type.endsWith('[]'))return arrayDecision(model.name,field.name).join(': ');
  if(/token|password|secret|verifier/i.test(field.name))return 'KEEP — security credential/state';
  if(/Count$|^(sent|opened|clicked|delivered|failed|bounced)$/.test(field.name))return 'KEEP — operational counter or historical metric; see table purpose';
  if(/At$|Date$|^createdById$|^movedById$|^convertedById$/.test(field.name))return 'KEEP — lifecycle time or actor provenance';
  if(/Id$/.test(field.name))return 'KEEP — relationship or historical/provider identity; see declared parents';
  if(model.name==='Deal'&&['value','currency'].includes(field.name))return 'KEEP — commercial snapshot, not current catalog default';
  if(['EmailDeliveryLog','EmailEvent','Activity','AuditLog','FormSubmission','CampaignContact','CrmImportRowResult','DealStageHistory'].includes(model.name))return 'KEEP — captured event/outcome fact';
  return 'KEEP — attribute owned by this row; not a separate entity';
};
out+='\n## Per-table evidence\n';
for(const model of allModels) {
  const [category,purpose,issue,action,risk]=decisions[model.name], table=live.tables.find(t=>t.name===model.name), after=cleanup?.counts.find(t=>t.table===model.name);
  out+=`\n### ${model.name}\n\n${purpose}. Category ${category}. ${action}\n\n`;
  out+=`- Initial audit rows: **${table?.rows??'unavailable'}**; immediately before cleanup: **${after?.before??'unavailable'}**; after cleanup: **${after?.after??'not executed'}**; final live rows: **${final.tables.find(t=>t.name===model.name)?.rows??'unavailable'}**.\n`;
  const timestamps=Object.entries(table?.latestTimestamps??{});out+=`- Timestamp maxima (UTC, field-specific; due/expiry dates are not evidence of activity): ${timestamps.length?timestamps.map(([k,v])=>`${k}=${v??'NULL'}`).join('; '):'No timestamp column; newest activity cannot be established from this table.'}\n`;
  out+=`- Primary key: ${(dropped.has(model.name)?live:final).constraints.filter(c=>c.table===model.name&&c.type==='p').map(c=>c.definition).join('; ')}.\n`;
  out+=`- Unique constraints/indexes: ${live.indexes.filter(c=>c.table===model.name&&c.definition.includes('UNIQUE')).map(c=>'`'+c.definition+'`').join('; ')||'None beyond primary key'}.\n`;
  out+=`- Parent relations: ${model.parents.map(f=>`${f.name}: ${f.type} (${f.attributes})`).join('; ')||'No declared Prisma parent relation'}.\n`;
  out+=`- Children: ${model.children.map(c=>`${c.model}.${c.relation}`).join('; ')||'None declared'}.\n`;
  out+=`- Direct runtime-source read sites: ${unique(model.reads.map(link)).join('; ')||'None found; see nested access below.'}\n`;
  out+=`- Direct runtime-source write sites: ${unique(model.writes.map(link)).join('; ')||'None found; see nested access below.'}\n`;
  const relevant=model.relationReferences.filter(r=>/repository|service|projections/.test(r.path));
  out+=`- Possible nested relation access (review with parent): ${unique(relevant.map(r=>link(r)+' `'+r.name+'`')).join('; ')||'None found.'}\n`;
  out+=`- Search matches across repository: ${model.references.length} in ${unique(model.references.map(r=>r.path)).length} files. Complete locations are reproducible in the local source evidence JSON.\n`;
  out+=`- Frontend contract dependency: ${dropped.has(model.name)?'None in supported routes. Historical DTO words are not storage dependencies.':'API consumers are located under frontend/src; read/write sites above are the authoritative API boundary. Security/integration internals are intentionally not directly exposed.'}\n`;
  out+=`- Worker/integration source dependencies: ${unique([...model.reads,...model.writes].filter(r=>/integration|worker|scheduler|notification|workflow|campaign/.test(r.path)).map(link)).join('; ')||'No direct worker/integration call; nested uses are listed above.'}\n`;
  out+=`- Normalization assessment: ${issue}. Final action: **${finalAction(model.name)}**. Risk: ${risk}.\n\n`;
  out+='| Scalar column | Prisma type | Nullability / default / annotations | Final null count | Ownership / action |\n|---|---|---|---|---|\n';
  for(const field of model.fields.filter(f=>!allModels.some(m=>m.name===f.type.replace(/[?\[\]]/g,'')))) out+=`| ${field.name} | ${field.type} | ${esc(field.attributes||'No explicit default; '+(field.type.endsWith('?')?'nullable':'required'))} | ${final.tables.find(t=>t.name===model.name)?.nullCounts?.[field.name]??(dropped.has(model.name)?'table dropped':'not captured')} | ${esc(ownership(model,field))} |\n`;
  for(const extra of live.columns.filter(c=>c.table===model.name&&!model.fields.some(f=>f.name===c.name))) out+=`| ${extra.name} (original compatibility column) | ${extra.nativeType} | nullable=${extra.nullable}; default=${esc(extra.default)} | ${final.tables.find(t=>t.name===model.name)?.nullCounts?.[extra.name]??'column dropped'} | DROP through guarded migration; ${final.columns.some(c=>c.table===model.name&&c.name===extra.name)?'still present in expanded live phase':'absent from current catalog'} |\n`;
  out+='\n<details><summary>Initial live constraints and indexes</summary>\n\n```sql\n';
  out+=live.constraints.filter(c=>c.table===model.name).map(c=>`-- ${c.name}; validated=${c.validated}\n${c.definition}`).join('\n')+'\n';
  out+=live.indexes.filter(c=>c.table===model.name).map(c=>c.definition+';').join('\n')+'\n```\n\n</details>\n';
  const finalConstraints=final.constraints.filter(c=>c.table===model.name), finalIndexes=final.indexes.filter(c=>c.table===model.name);
  if(JSON.stringify(finalConstraints)!==JSON.stringify(live.constraints.filter(c=>c.table===model.name)) || JSON.stringify(finalIndexes)!==JSON.stringify(live.indexes.filter(c=>c.table===model.name))) {
    out+='\n<details><summary>Final live constraints and indexes (changed since initial audit)</summary>\n\n```sql\n';
    out+=finalConstraints.map(c=>`-- ${c.name}; validated=${c.validated}\n${c.definition}`).join('\n')+'\n';
    out+=finalIndexes.map(c=>c.definition+';').join('\n')+'\n```\n\n</details>\n';
  }
}
out+='\n### _prisma_migrations\n\nPrisma-owned migration ledger; category F. Retained unchanged by data cleanup. Primary key id. No business FK. Prisma migrate reads and writes it; application runtime does not. Original rows: '+live.migrations.length+'. Never treat failed/rolled-back attempts as successful application.\n';
out+='\n## Every JSON field\n\n| Field | Decision | Reason |\n|---|---|---|\n';
for(const model of source.models) for(const field of model.fields.filter(f=>f.type.startsWith('Json'))) {const [decision,reason]=jsonDecision(model.name,field.name);out+=`| ${model.name}.${field.name} | ${decision} | ${reason} |\n`;}
out+='\n## Every scalar array field\n\n| Field | Decision | Reason |\n|---|---|---|\n';
for(const model of source.models) for(const field of model.fields.filter(f=>f.type.endsWith('[]')&&!names.has(f.type.slice(0,-2)))) {const [decision,reason]=arrayDecision(model.name,field.name);out+=`| ${model.name}.${field.name} | ${decision} | ${reason} |\n`;}
out+='\n## Live enum domains\n\n| Enum | Values |\n|---|---|\n';
for(const name of unique(final.enums.map(e=>e.name))) out+=`| ${name} | ${final.enums.filter(e=>e.name===name).map(e=>e.value).join(', ')} |\n`;
out+='\n## Current live database triggers\n\nFull function definitions are captured in private catalog evidence. Temporary compatibility bridges are removed by migration 86.\n\n| Table | Trigger | Function |\n|---|---|---|\n';
for(const trigger of final.triggers??[]) out+=`| ${trigger.table} | ${trigger.name} | ${trigger.function} |\n`;
out+='\n## All migration files and final live ledger comparison\n\nHistorical files are unchanged by this work. Checksum comparison accepts only LF/CRLF differences. A mismatch is reported, not repaired by editing history.\n\n| Migration | Lines | Successful live record | Checksum | Referenced tables |\n|---|---|---|---|---|\n';
live.migrations=final.migrations;
for(const m of source.migrations) { const records=live.migrations.filter(r=>r.migration_name===m.name&&r.finished_at&&!r.rolled_back_at);const sql=readFileSync(resolve(root,'backend/prisma/migrations',m.name,'migration.sql'),'utf8');const lf=sql.replace(/\r\n/g,'\n');const hashes=[sql,lf,lf.replace(/\n/g,'\r\n')].map(v=>createHash('sha256').update(v).digest('hex'));out+=`| [${m.name}](../../backend/prisma/migrations/${m.name}/migration.sql) | ${m.lines} | ${records.length} | ${records.length?(records.every(r=>hashes.includes(r.checksum))?'MATCH':'MISMATCH'):'NOT APPLIED'} | ${m.referencedTables.join(', ')} |\n`;}
writeFileSync(resolve(destination,'normalization-inventory.md'),out);
let erd='# Current relational map\n\nGenerated from declared Prisma foreign keys; polymorphic history references and provider identifiers are intentionally not drawn as FKs. Composite tenant relations are annotated in the schema. See [inventory](normalization-inventory.md) for all attributes and live-only drift.\n\n```mermaid\nerDiagram\n';
for(const model of source.models) {
  if(!model.parents.length&&!model.children.length) erd+=`    ${model.name} {\n        string primary_key\n    }\n`;
  for(const parent of model.parents) erd+=`    ${parent.type.replace('?','')} ${parent.type.endsWith('?')?'|o':'||'}--o{ ${model.name} : "${parent.name}"\n`;
}
erd+='```\n';writeFileSync(resolve(destination,'normalization-erd.md'),erd);
console.log(JSON.stringify({tables:source.models.length,jsonFields:source.models.flatMap(m=>m.fields).filter(f=>f.type.startsWith('Json')).length,scalarArrays:source.models.flatMap(m=>m.fields).filter(f=>f.type.endsWith('[]')&&!names.has(f.type.slice(0,-2))).length,inventoryLines:out.split('\n').length}));
