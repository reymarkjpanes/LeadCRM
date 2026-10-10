const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { homedir } = require('node:os');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), process.env.PLAYWRIGHT_NODE_PATH || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node')] }));
const out = path.resolve('data/outputs/campaign-sms'); fs.mkdirSync(out, { recursive: true });
const base = 'http://localhost:3108', checks = [], requests = [];
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: id(1), tenantId: id(2), role: 'Client Admin', status: 'ACTIVE', firstName: 'Local', lastName: 'QA', email: 'qa@camxian.com', mustChangePassword: false, onboardingCompletedAt: '2026-01-01T00:00:00Z', onboardingStep: 3, tenantStatus: 'ACTIVE', tenantName: 'QA Workspace' };
const agent = { ...user, id: id(3), firstName: 'Valid', lastName: 'Agent', role: 'Sales', email: 'agent@example.test' };
const source = fs.readFileSync('backend/src/modules/marketing/templates/default-templates.ts', 'utf8');
const templates = [...source.matchAll(/name: '([^']+)', type: '(Email|SMS)', category: 'Sales', (?:subject: '([^']+)', )?content: (?:`([^`]+)`|'([^']+)')/g)].map((m,i) => ({ id: id(10+i), tenantId: user.tenantId, name:m[1], type:m[2], category:'Sales', subject:m[3], content:m[4] || m[5], isArchived:false }));
assert.equal(templates.length,6);
const products = [{id:id(30),name:'CCTV',active:true,dealValue:100},{id:id(31),name:'Access Control',active:true,dealValue:200}];
let audiences = [];
const server = http.createServer(async(req,res)=>{
  const p = new URL(req.url,'http://localhost').pathname.replace('/api/v1','');
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  requests.push({path:p,method:req.method,body});res.setHeader('Content-Type','application/json');
  if(!(req.headers.cookie||'').includes('leadcrm_token=campaign-sms-qa')){res.statusCode=401;res.end(JSON.stringify({error:'Authentication required'}));return;}
  let data=[],meta={total:0,page:1,limit:25,hasMore:false};
  if(p==='/auth/me')data={user};
  else if(p==='/administration/users'){data=[user,agent];meta.total=2;}
  else if(p.endsWith('/permissions'))data={};
  else if(p==='/administration/product-interests'){data=products;meta={enabled:true};}
  else if(p==='/marketing/templates'){data=templates;meta.total=6;}
  else if(p==='/marketing/campaigns/metrics')data={activeCampaigns:0,sent:0,opened:0,clicked:0};
  else if(p==='/marketing/campaigns/sms-settings')data={organizationEmail:'info@example.test'};
  else if(p==='/marketing/audiences/preview'){
    const total=28,page=body.page||1,limit=body.limit||25;
    data={matched:total,eligible:total,missingEmail:0,invalidEmail:0,duplicateEmail:0,staffEmail:0,unsubscribed:0,blocked:0,inactive:0,recipientNotAllowed:0,missingPhone:0,invalidPhone:0,duplicatePhone:0,doNotContact:0,
      recipients:Array.from({length:Math.max(0,Math.min(limit,total-(page-1)*limit))},(_,i)=>({id:id(100+(page-1)*limit+i),name:'Recipient '+((page-1)*limit+i+1),recordType:i%2?'Lead':'Contact',company:'Example Company',email:'customer@example.test',phone:'+639171234567'})),meta:{page,limit,total,hasMore:page*limit<total}};
  }else if(p==='/marketing/audiences'){if(req.method==='POST'){data={...body,id:id(50)};audiences.push(data);}else data=audiences;}
  else if(p.startsWith('/preferences/'))data={columns:[],pageSize:25,viewMode:'wrap',sort:null,viewType:'table'};
  else if(p==='/integrations/gmail/status'){res.end(JSON.stringify({isConnected:false}));return;}
  res.end(JSON.stringify({success:true,data,meta}));
});
let browser,page;
const check = (label,extra={})=>checks.push({label,...extra});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  await new Promise(resolve=>server.listen(4108,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:960},timezoneId:'Asia/Manila'});
  await context.addCookies([{name:'leadcrm_token',value:'campaign-sms-qa',url:base,httpOnly:true,sameSite:'Lax'}]);
  page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/marketing/campaigns');await page.getByRole('heading',{name:'Campaigns',exact:true}).waitFor();
  for(const type of ['Email','SMS']){
    await page.getByRole('button',{name:type+' Templates',exact:true}).click();
    for(const template of templates.filter(t=>t.type===type))await page.getByText(template.name,{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Preview',exact:true}).count(),3);
    for(const [index,template] of templates.filter(t=>t.type===type).entries()){
    await page.getByRole('button',{name:'Preview',exact:true}).nth(index).click();
    await page.getByRole('heading',{name:'Template Preview'}).waitFor();
    await page.getByRole('button',{name:'Use Template',exact:true}).last().click();
    await page.getByLabel('Body',{exact:false}).waitFor();
    assert.equal(await page.getByLabel('Body',{exact:false}).inputValue(),template.content);
    assert.equal(await page.getByLabel('Subject Line',{exact:false}).count(),type==='Email'?1:0);
    if(type==='Email')assert.equal(await page.getByLabel('Subject Line',{exact:false}).inputValue(),template.subject);
    if(type==='SMS')await page.getByText(/For product inquiries, contact Camxian Technologies at info@example.test/).waitFor();
    check(type+'-template-preview-use',{name:template.name});
    await page.getByRole('button',{name:'Back to campaigns'}).click();
    await page.getByRole('button',{name:type+' Templates',exact:true}).click();
    }
  }
  await page.getByRole('button',{name:'Create Campaign',exact:true}).click();
  const subject=page.getByLabel('Subject Line',{exact:false}),body=page.getByLabel('Body',{exact:false});
  await subject.fill('Your proposal');await subject.click();await subject.evaluate(el=>el.setSelectionRange(5,5));
  await page.getByRole('button',{name:'{{first_name}}',exact:true}).click();
  assert.equal(await subject.inputValue(),'Your {{first_name}}proposal');check('subject-click-caret');
  await body.fill('Thank you, customer.');await body.click();await body.evaluate(el=>el.setSelectionRange(11,19));
  await page.getByRole('button',{name:'Insert Variable'}).click();await page.getByRole('button',{name:'{{company_name}}',exact:true}).first().click();
  assert.equal(await body.inputValue(),'Thank you, {{company_name}}.');check('body-click-selection');
  async function dragInto(field,token,value){
    await field.fill(value);await field.scrollIntoViewIfNeeded();
    const chip=page.getByRole('button',{name:token,exact:true});await chip.scrollIntoViewIfNeeded();
    const box=await field.boundingBox();
    await chip.dragTo(field,{targetPosition:{x:55,y:Math.min(20,box.height/2)}});
    await sleep(150);const actual=await field.inputValue();assert(actual.includes(token),`Native drag did not insert ${token}: ${actual}`);
    assert(!actual.endsWith(token),'Drop unexpectedly appended to end');check('native-drag-'+(await field.getAttribute('id')),{actual});
  }
  await dragInto(subject,'{{first_name}}','Your proposal is ready');
  await dragInto(body,'{{company_name}}','Thank you for your interest.\nAnother line.');
  const responsive=async label=>{for(const width of [1440,768,390,375,320]){
    await page.setViewportSize({width,height:960});await sleep(250);
    const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(size.scroll<=size.width+1,label+' page overflow');
    if(label.endsWith('builder')){
      await body.scrollIntoViewIfNeeded();const box=await body.boundingBox();assert(box.height>=200&&box.width>150,'Body is squeezed');
      await body.click();await page.getByRole('button',{name:'{{status}}',exact:true}).click();assert((await body.inputValue()).includes('{{status}}'),'Mobile click insertion failed');
      await page.getByLabel('Campaign Name').scrollIntoViewIfNeeded();
    }
    await page.screenshot({path:path.join(out,`${label}-${width}.png`),fullPage:true});check(label,{...size});
  }};
  await responsive('email-builder');await page.setViewportSize({width:1440,height:960});
  await page.getByRole('button',{name:'SMS',exact:true}).click();await page.getByText(/For product inquiries, contact Camxian Technologies at info@example.test/).waitFor();
  await dragInto(body,'{{first_name}}','Hello customer, your proposal is ready.');await responsive('sms-builder');
  await page.setViewportSize({width:1440,height:960});await page.getByRole('button',{name:/Create New/}).click();
  await page.getByRole('heading',{name:'Eligible Recipients'}).waitFor();await page.getByText('Showing 25 of 28 eligible recipients').waitFor();
  await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByText('Showing 3 of 28 eligible recipients').waitFor();check('recipient-pagination');
  await page.getByRole('button',{name:'+ Add Condition',exact:true}).click();
  const field=page.locator('select[id^="field-"]').last();const value=page.locator('select[id^="value-"]').last();
  assert.deepEqual(await value.locator('option').allTextContents(),['Select status','Hot','Warm','Cold','Closed','Cancelled']);
  await value.selectOption('Hot');check('canonical-status');
  await field.selectOption('source');assert.equal(await value.locator('option').count(),10);await value.selectOption('Website');check('canonical-source');
  await field.selectOption('company');await page.locator('input[id^="value-"]').fill('Example');check('company-text');
  await field.selectOption('assignedUserId');await page.getByRole('combobox',{name:'Select Assigned Agent'}).click();
  await page.getByRole('option',{name:/Valid Agent/}).click();assert.equal(await page.getByRole('option',{name:/Local QA/}).count(),0);check('agent-name');
  await field.selectOption('productInterest');await page.getByRole('button',{name:'Product Interest',exact:true}).click();
  await page.getByRole('checkbox',{name:'CCTV',exact:true}).check();await page.getByRole('checkbox',{name:'Access Control',exact:true}).check();await page.keyboard.press('Escape');
  await page.getByText('2 selected',{exact:true}).waitFor();check('multi-product');
  await responsive('audience-product');
  for(const width of [1440,768,390,375,320]){
    await page.setViewportSize({width,height:960});await page.getByRole('button',{name:'Product Interest',exact:true}).click();
    const menu=page.getByRole('group',{name:'Product interests',exact:true});const box=await menu.boundingBox();assert(box.x>=-1&&box.x+box.width<=width+1,'Product menu outside viewport');await page.keyboard.press('Escape');
    const action=await page.getByRole('button',{name:'Create Audience',exact:true}).boundingBox();assert(action.y>=0&&action.y+action.height<=960,'Footer out of view');check('product-menu-footer',{width});
  }
  await page.setViewportSize({width:1440,height:960});await field.selectOption('createdAt');
  assert.deepEqual(await page.locator('select[id^="operator-"]').last().locator('option').allTextContents(),['Any date','≤ Less than or equal','≥ Greater than or equal','Range']);
  await page.locator('select[id^="operator-"]').last().selectOption('between');await page.getByLabel('Created From',{exact:true}).fill('2026-10-08');await page.getByLabel('Created To',{exact:true}).fill('2026-10-07');
  await page.getByText('Enter valid dates with From on or before To.').waitFor();await page.getByLabel('Created To',{exact:true}).fill('2026-10-09');await page.getByText('Showing 25 of 28 eligible recipients').waitFor();check('date-range-validation');await responsive('audience-date');
  await page.getByRole('button',{name:'+ Add Condition',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Remove condition',exact:true}).count(),2);
  await page.getByRole('button',{name:'Remove condition',exact:true}).first().click();assert.equal(await page.getByRole('button',{name:'Remove condition',exact:true}).count(),1);check('delete-only-selected-row');
  assert.equal(requests.some(r=>r.path.includes('/send')),false);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors,providerCalls:0},null,2));console.log(JSON.stringify({passed:checks.length,errors},null,2));
})().catch(async error=>{console.error(error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
