// Builds exhaustive source evidence without assuming that a text match is runtime usage.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, process.argv[2] || 'data/outputs/database-audit/source.json');
const schema = readFileSync(resolve(root,'backend/prisma/schema.prisma'),'utf8');
const models = [...schema.matchAll(/^model (\w+) \{\r?\n([\s\S]*?)^\}/gm)].map(([,name,body]) => ({name, body,
  fields: body.split('\n').map(line => line.trim()).filter(line => /^\w+\s/.test(line)).map(line => { const [,name,type,attributes] = line.match(/^(\w+)\s+(\S+)\s*(.*)$/); return {name,type,attributes}; }),
  constraints:body.split('\n').map(line=>line.trim()).filter(line=>line.startsWith('@@')),
  references:[], reads:[], writes:[], relationReferences:[],
}));
const modelNames = new Set(models.map(m=>m.name));
const files = execFileSync('rg',['--files','--hidden','-g','!.git','-g','!node_modules','-g','!**/node_modules','-g','!data/outputs/**','-g','!*.log','-g','!package-lock.json','-g','!.env*'],{cwd:root,encoding:'utf8',maxBuffer:20e6}).trim().split(/\r?\n/).filter(f=>/\.(?:ts|tsx|js|jsx|cjs|mjs|md|sql|prisma|json|yml|yaml)$/.test(f) && !f.replaceAll('\\','/').startsWith('docs/database/normalization'));
for (const model of models) {
  model.parents=model.fields.filter(f=>modelNames.has(f.type.replace(/[?\[\]]/g,'')) && /fields:/.test(f.attributes));
  model.children=models.flatMap(child=>child.fields.filter(f=>f.type.replace(/[?\[\]]/g,'')===model.name && /fields:/.test(f.attributes)).map(f=>({model:child.name,relation:f.name,definition:f.attributes})));
}
for (const file of files) {
  const path=file.replaceAll('\\','/');
  const content=readFileSync(resolve(root,file),'utf8');
  const runtime=path.startsWith('backend/src/') && !/(?:__tests__|\.test\.|\.preview\.|\/tests\/|\/database\/seeders\/|\/scripts\/)/.test(path);
  for (const model of models) {
    const delegate=model.name[0].toLowerCase()+model.name.slice(1);
    const expression=new RegExp(`\\b(?:${model.name}|${delegate})\\b`,'g');
    for (const match of content.matchAll(expression)) {
      const line=content.slice(0,match.index).split('\n').length;
      model.references.push({path,line,runtime});
    }
    if (!runtime) continue;
    const calls=new RegExp(`\\.${delegate}\\s*\\.\\s*(find\\w+|count|aggregate|groupBy|create\\w*|update\\w*|delete\\w*|upsert)\\s*\\(`,'g');
    for(const match of content.matchAll(calls)) {
      const line=content.slice(0,match.index).split('\n').length;
      model[/^(?:find|count|aggregate|groupBy)/.test(match[1])?'reads':'writes'].push({path,line,operation:match[1]});
    }
    const relationNames = new Set(model.children.map(c=>c.relation));
    for(const parent of models) for(const f of parent.fields) if(f.type.replace(/[?\[\]]/g,'')===model.name && !/fields:/.test(f.attributes)) relationNames.add(f.name);
    for(const name of relationNames) {
      const match=new RegExp(`\\b${name}\\s*:`).exec(content);
      if(match) model.relationReferences.push({path,line:content.slice(0,match.index).split('\n').length,name});
    }
  }
}
const migrationsDir=resolve(root,'backend/prisma/migrations');
const migrations=readdirSync(migrationsDir,{withFileTypes:true}).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>{
  const path=resolve(migrationsDir,e.name,'migration.sql'); const sql=readFileSync(path,'utf8');
  return {name:e.name,sha256:createHash('sha256').update(sql).digest('hex'),lines:sql.split('\n').length,
    operations:sql.split('\n').map(s=>s.trim()).filter(s=>/^(?:CREATE|ALTER|DROP|UPDATE|INSERT|DELETE|TRUNCATE|DO\s)/i.test(s)),
    referencedTables:[...new Set([...sql.matchAll(/(?:TABLE(?: IF (?:NOT )?EXISTS)?|INTO|REFERENCES|UPDATE|JOIN)\s+"(\w+)"/g)].map(m=>m[1]))]};
});
mkdirSync(resolve(output,'..'),{recursive:true});
writeFileSync(output,JSON.stringify({scannedFiles:files.length,modelCount:models.length,models,migrations},null,2));
console.log(JSON.stringify({output:relative(root,output),scannedFiles:files.length,models:models.length,migrations:migrations.length,noDirectRuntimeCalls:models.filter(m=>!m.reads.length&&!m.writes.length).map(m=>m.name)},null,2));
