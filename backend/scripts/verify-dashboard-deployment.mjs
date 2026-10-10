// Public, read-only probes; authenticated production acceptance is separate.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const output=resolve(import.meta.dirname,'../../data/outputs/dashboard-verification'); mkdirSync(output,{recursive:true});
const checks=[];
for(const url of ['https://lead-crm.tech/login','https://api.lead-crm.tech/health','https://api.lead-crm.tech/api/v1/health','https://api.lead-crm.tech/api/v1/reporting/dashboard','https://lead-crm.tech/api/proxy/reporting/dashboard']) {
  try { const response=await fetch(url,{signal:AbortSignal.timeout(20000)}); const type=response.headers.get('content-type') ?? ''; const body=type.includes('application/json') ? await response.json() : undefined;
    checks.push({url,status:response.status,...(url.endsWith('/health') ? {body} : {})});
  } catch(error) { checks.push({url,error:error.name}); }
}
const result={checkedAt:new Date().toISOString(),checks}; writeFileSync(resolve(output,'deployment-probes.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
