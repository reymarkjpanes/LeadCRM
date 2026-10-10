// Isolated UI fixture: no database, Brevo calls, messages or production credentials.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve('data/outputs/campaign-clicks'); fs.mkdirSync(out, { recursive: true });
const user = { id: 'qa', tenantId: 'qa', role: 'Client Admin', status: 'ACTIVE', firstName: 'Campaign', lastName: 'QA', email: 'qa@camxian.com', mustChangePassword: false, onboardingCompletedAt: '2026-01-01T00:00:00Z', onboardingStep: 3, tenantStatus: 'ACTIVE', tenantName: 'Local Campaign QA' };
const campaign = { id: 'report', tenantId: 'qa', name: 'Local click verification', type: 'EMAIL', status: 'DELIVERED', recipientCount: 1, sentCount: 1, failedCount: 0, openedCount: 1, clickedCount: 1, engagement: 100, audienceSource: 'LEADS', body: 'Hi {{first_name}}\nhttps://camxian.com/\nhttps://camxian.com/products?a=1&b=2', subject: 'Local hyperlink check', createdAt: '2026-10-09T07:00:00Z', sentAt: '2026-10-09T07:00:00Z' };
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname.replace('/api/v1', '');
  let raw = ''; for await (const part of req) raw += part;
  const body = raw ? JSON.parse(raw) : {};
  let data = [], meta = { total: 0, page: 1, limit: 25, hasMore: false };
  res.setHeader('Content-Type', 'application/json');
  if (p === '/auth/me') data = { user };
  else if (p === '/marketing/campaigns') { data = req.method === 'POST' ? { ...campaign, ...body, id: 'saved', status: 'DRAFT' } : [campaign]; meta.total = 1; }
  else if (p === '/marketing/campaigns/metrics') data = { activeCampaigns: 0, sent: 1, emailSent: 1, opened: 1, clicked: 1 };
  else if (p === '/marketing/campaigns/report/report') {
    if (process.env.CAMPAIGN_PREVIEW_REPORT_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(0, Number(process.env.CAMPAIGN_PREVIEW_REPORT_DELAY_MS) || 0))));
    const statePath = path.join(out, 'state.json');
    const total = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)).totalClicks : 21;
    data = { ...campaign, deliveredCount: 1, bouncedCount: 0, uniqueOpens: 1, totalOpens: 2, uniqueClicks: 1, totalClicks: total, ctr: 100, ctor: 100, trackingStatus: 'recorded', trackingUpdatedAt: '2026-10-09T07:10:00Z',
      recipients: [{ id: 'recipient', name: 'Local Recipient', email: 'recipient@example.test', deliveryStatus: 'Delivered', opened: true, clicked: true, lastActivity: '2026-10-09T07:10:00Z', failureReason: null }],
      topLinks: Array.from({ length: 6 }, (_, i) => { const clicks = i ? 6 - i : total - 15; return { url: 'https://camxian.com/' + (i ? 'products?item=' + i : ''), totalClicks: clicks, uniqueClicks: 1, clickShare: clicks / total * 100, clickRate: 100, lastClicked: '2026-10-09T07:10:00Z' }; }) };
  } else if (p === '/marketing/campaigns/report') data = campaign;
  else if (p === '/marketing/campaigns/sms-settings') data = { organizationEmail: null };
  else if (p === '/marketing/campaigns/email-settings') data = { senderName: 'Local configured sender', senderEmail: 'sender@example.test' };
  else if (p === '/marketing/audiences/preview') data = { matched: 1, eligible: 1, recipients: [], meta, missingEmail: 0, invalidEmail: 0, duplicateEmail: 0, staffEmail: 0, unsubscribed: 0, blocked: 0, inactive: 0, recipientNotAllowed: 0 };
  else if (p.startsWith('/preferences/')) data = { columns: [], pageSize: 25, viewMode: 'wrap', sort: null, viewType: 'table' };
  else if (p === '/integrations/gmail/status') { res.end(JSON.stringify({ isConnected: false })); return; }
  if (req.method !== 'GET') fs.appendFileSync(path.join(out, 'mutations.jsonl'), JSON.stringify({ path: p, body }) + '\n');
  res.end(JSON.stringify({ success: true, data, meta }));
});
server.listen(4116, '127.0.0.1', () => console.log('Local Campaigns fixture: 127.0.0.1:4116'));
