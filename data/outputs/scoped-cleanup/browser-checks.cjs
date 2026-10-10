const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/Julie Ann Tiron/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = __dirname;
const base = 'http://localhost:3107';
const user = { id:'qa-user', tenantId:'qa-tenant', role:'Client Admin', status:'ACTIVE', firstName:'Local', lastName:'QA', email:'qa@camxian.com', mustChangePassword:false, onboardingCompletedAt:'2026-01-01T00:00:00Z', onboardingStep:3, tenantStatus:'ACTIVE', tenantName:'QA Workspace' };
const products = [{id:'10000000-0000-4000-8000-000000000001', name:'Network Infrastructure', dealValue:25000, active:true}, {id:'10000000-0000-4000-8000-000000000002', name:'CCTV Surveillance System', dealValue:15000, active:true}];
const common={id:'one',tenantId:'qa-tenant',createdAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-01T12:00:00Z',status:'Warm',productInterest:products.map(p=>p.name),productInterests:products.map(p=>p.name),productInterestIds:products.map(p=>p.id)};
const records={leads:{...common, firstName:'Ada',lastName:'Lovelace',email:'ada@example.test',companyName:'Example Company'},contacts:{...common, firstName:'Grace',lastName:'Hopper',email:'grace@example.test',company:'Example Company'},accounts:{...common,name:'Example Company',country:'Philippines'},deals:{...common,title:'Example Deal',value:25000,currency:'PHP',pipelineId:'pipeline',stageId:'stage',stage:{id:'stage',name:'Lead'},pipeline:{id:'pipeline',name:'Sales'},contactIds:[],contactDeals:[],leadDeals:[],priority:'MEDIUM'}};
const workflow={id:'wf',name:'New Lead Follow-up',trigger:'lead.created',status:'ACTIVE',isActive:true,actions:[],conditions:null,totalRuns:1,successfulRuns:1,failedRuns:0};
const run={id:'run',status:'completed',startedAt:'2026-10-01T12:00:00Z',completedAt:'2026-10-01T12:00:05Z',entityType:'lead',trigger:{triggerType:'lead_created',payload:{recordName:'Ada Lovelace'}},steps:[{id:'step',stepIndex:0,actionType:'create_task',status:'completed'}]};
const apiRequests=[];let delayedRuns=true;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'); const p=url.pathname.replace('/api/v1','');
 const authenticated=(req.headers.cookie||'').includes('leadcrm_token=local-qa-session');
 apiRequests.push({path:p,authenticated,method:req.method});
 res.setHeader('Content-Type','application/json');
 if(!authenticated){res.statusCode=401;res.end(JSON.stringify({error:'Authentication required'}));return;}
 let data=[],meta={total:0,totalPages:1,page:1,limit:25,pageSize:25,hasMore:false};
 if(p==='/auth/me')data={user};
 else if(p.endsWith('/permissions'))data=p.includes('/users/')?{}:[];
 else if(p==='/administration/users')data=[user];
 else if(p==='/administration/product-interests'){data=products;meta={enabled:true};}
 else if(p==='/administration/closing-requirements')data=[];
 else if(p.includes('closing-requirements'))data={fields:[],values:{},errors:{},files:[],locked:false};
 else if(p==='/crm/pipelines')data=[{id:'pipeline',name:'Sales Pipeline',stages:[{id:'stage',name:'Lead',order:0,isDefault:true}]}];
 else if(p.endsWith('/relationships'))data={account:null,contact:null,sourceLead:null,contacts:[],leads:[],deals:[],activities:[]};
 else if(p==='/automation/workflows'){data=[workflow];meta={...meta,total:1};}
 else if(p==='/automation/triggers')data=[{type:'lead.created',label:'Lead created'}];
 else if(p==='/automation/workflows/wf/executions'){if(delayedRuns)await new Promise(r=>setTimeout(r,900));data=[run];}
 else if(p.startsWith('/preferences/'))data={columns:[],pageSize:25,viewMode:'wrap',sort:null,viewType:'table'};
 else if(p==='/integrations/gmail/status'){res.end(JSON.stringify({isConnected:false}));return;}
 else { const m=p.match(/^\/crm\/(leads|contacts|accounts|deals)(?:\/one)?$/); if(m){data=p.endsWith('/one')?records[m[1]]:[records[m[1]]];meta.total=1;} }
 res.end(JSON.stringify({success:true,data,meta}));
});
const checks=[];let browser;
(async()=>{
 await new Promise(r=>server.listen(4107,'127.0.0.1',r));
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addCookies([{name:'leadcrm_token',value:'local-qa-session',url:base,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();global.qaPage=page; page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(120000);
 const pageErrors=[];page.on('pageerror',e=>{pageErrors.push(e.message);console.log('PAGE ERROR',e.stack);});
 const paths=[];page.on('request',r=>{if(r.url().includes('/api/'))paths.push(new URL(r.url()).pathname);});
 async function navigate(url){await page.goto(base+url);}
 async function overflow(label,width){const result=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));if(result.scroll>width+1)throw Error(`${label}: page overflow ${JSON.stringify(result)}`);checks.push({label,width,...result});}
 // Actual frontend -> same-origin Next proxy -> local fixture server, with HttpOnly cookie forwarding.
 for(const [url,heading] of [['/crm/leads','Leads'],['/crm/contacts','Contacts'],['/crm/accounts','Accounts'],['/crm/deals','Deals'],['/settings?tab=users','Team Management'],['/automation/workflows','Workflows']]){
  await navigate(url);if(heading==='Team Management') await page.getByRole('button',{name:/^Users/}).first().waitFor(); else await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();console.log('Navigation OK',url);
 }
 await page.getByRole('button',{name:'View runs',exact:true}).click();
 await page.getByRole('dialog',{name:'Runs — New Lead Follow-up'}).waitFor();
 await page.getByRole('status',{name:'Loading workflow runs'}).waitFor();
 await page.locator('details summary').waitFor();
 for(const width of [320,375,390,768,1440]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(350);
  const dialog=page.getByRole('dialog',{name:'Runs — New Lead Follow-up'});const box=await dialog.boundingBox();
  if(Math.abs(box.x+box.width-width)>2 || (width<640&&Math.abs(box.width-width)>2))throw Error('Incorrect Runs panel width '+JSON.stringify(box));
  await dialog.locator('summary').click();
  await overflow('workflow-runs',width);await page.screenshot({path:path.join(out,`runs-${width}.png`)});
 }
 await page.getByRole('button',{name:'Close workflow runs'}).click();
 for(const module of ['leads','contacts','accounts','deals']){
  await navigate(`/crm/${module}/one`);const label=module[0].toUpperCase()+module.slice(1);
  await page.getByRole('button',{name:`Back to ${label}`,exact:true}).waitFor();
  await page.getByRole('tab',{name:/Details/}).click();
  const required=module==='contacts'?['First name','Last name']:module==='accounts'?['Account name']:[];
  for(const field of required){
   await page.getByRole('button',{name:`Edit ${field}`,exact:true}).click();
   await page.getByRole('textbox',{name:field,exact:true}).fill('   ');
   await page.getByRole('button',{name:'Save',exact:true}).click();
   await page.getByRole('alert').filter({hasText:`${field} is required`}).waitFor();
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
  }
  // Shared inline Product Interest selector in all four record modules.
  await page.getByRole('button',{name:'Edit Product interests',exact:true}).click();
  const select=page.getByRole('button',{name:'Product Interest',exact:true});await select.waitFor();
  for(const width of [320,375,390,768,1440]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(350);await select.scrollIntoViewIfNeeded();
   await select.click();const menu=page.getByRole('group',{name:'Product interests',exact:true});await menu.waitFor();
   const box=await menu.boundingBox();if(box.x<0||box.x+box.width>width+1)throw Error('Product menu overflow '+module+' '+width);
   const selected=await menu.getByRole('checkbox').evaluateAll(nodes=>nodes.filter(n=>n.checked).length);
   if(selected!==2)throw Error('Selection lost '+module);
   await overflow(`${module}-products`,width);await menu.evaluate(el=>new Promise(resolve=>{const settled=()=>Number(getComputedStyle(el).opacity)>=1?resolve():requestAnimationFrame(settled);settled();}));await page.screenshot({path:path.join(out,`${module}-${width}.png`)});
   await page.keyboard.press('Escape');
   if(await select.locator('..').locator('..').locator('> div.mt-2').count())throw Error('Duplicate selected list');
  }
  await page.getByRole('button',{name:'Cancel',exact:true}).click();console.log('Responsive OK',module);
 }
 for(const [module,create] of [['leads','Create Lead'],['contacts','Create Contact'],['accounts','Add Account'],['deals','New Deal']]){
  await page.setViewportSize({width:1440,height:900});await navigate(`/crm/${module}`);
  await page.getByRole('button',{name:new RegExp(create)}).click();
  await page.getByRole('menuitem',{name:'Create New',exact:true}).click();
  const select=page.getByRole('button',{name:'Product Interest',exact:true});await select.waitFor();await select.click();
  const options=page.getByRole('group',{name:'Product interests',exact:true});
  await options.getByRole('checkbox',{name:products[0].name,exact:true}).check();
  await options.getByRole('checkbox',{name:products[1].name,exact:true}).check();
  await page.keyboard.press('Escape');
  if(!(await select.textContent()).includes('2 selected'))throw Error('Missing selected count '+module);
  for(const width of [320,375,390,768,1440]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(350);await select.scrollIntoViewIfNeeded();await select.click();await options.waitFor();
   const box=await options.boundingBox();if(box.x<0||box.x+box.width>width+1)throw Error('Creation menu overflow '+module+' '+width);
   if(await options.getByRole('checkbox').evaluateAll(nodes=>nodes.filter(n=>n.checked).length)!==2)throw Error('Creation checkbox state lost');
   await overflow(`${module}-create-products`,width);await options.evaluate(el=>new Promise(resolve=>{const settled=()=>Number(getComputedStyle(el).opacity)>=1?resolve():requestAnimationFrame(settled);settled();}));await page.screenshot({path:path.join(out,`${module}-create-${width}.png`)});await page.keyboard.press('Escape');await options.waitFor({state:'detached'});
   if(await select.locator('..').locator('..').getByText(products[0].name,{exact:true}).count())throw Error('Duplicate selected creation products '+module);
  }
  console.log('Creation responsive OK',module);
 }
 await navigate('/settings?tab=custom-fields');await page.getByRole('heading',{name:'Custom Fields',exact:true}).waitFor();
 await page.getByText('Closed Won Requirements',{exact:true}).waitFor();
 if(await page.getByText('Product Interest',{exact:true}).count())throw Error('Redundant Custom Fields card remains');
 const signedIn=apiRequests.slice();if(signedIn.some(r=>!r.authenticated))throw Error('Unsigned protected API request');
 if(paths.some(p=>!p.startsWith('/api/proxy/')&&p!=='/api/keep-alive'))throw Error('Protected request bypassed proxy');
 await context.clearCookies();const response=await context.request.get(base+'/api/proxy/crm/leads');if(response.status()!==401)throw Error('Signed-out request not 401');
 fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,requests:signedIn,clientPaths:[...new Set(paths)],signedOutStatus:response.status(),pageErrors},null,2));
 console.log(JSON.stringify({checks:checks.length,authenticatedRequests:signedIn.length,signedOutStatus:response.status(),pageErrors}));
})().catch(async e=>{if(global.qaPage){await global.qaPage.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.html'),await global.qaPage.content());}console.error(e);process.exitCode=1;fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({error:e.message,checks,requests:apiRequests},null,2));}).finally(async()=>{await browser?.close();server.close();});
