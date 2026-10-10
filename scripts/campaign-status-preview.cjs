// Local UI acceptance fixture only. Never contacts providers or a database.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: id(1), tenantId: id(2), role: 'Client Admin', status: 'ACTIVE', firstName: 'Local', lastName: 'QA', email: 'qa@example.test', mustChangePassword: false, onboardingCompletedAt: '2026-01-01T00:00:00Z', onboardingStep: 3, tenantStatus: 'ACTIVE', tenantName: 'Campaign QA' };
const stateFile = path.resolve('data/outputs/campaign-status-preview-state.json');
const requestsFile = path.resolve('data/outputs/campaign-status-preview-requests.jsonl');
fs.mkdirSync(path.dirname(requestsFile), { recursive: true });
const statuses = ['DRAFT', 'SENT', 'PARTIALLY_SENT', 'DELIVERED', 'FAILED'];
const campaigns = statuses.map((status, index) => ({ id: id(10 + index), tenantId: user.tenantId, name: `${status} example`, type: 'EMAIL', status, targetAudience: { name: 'Controlled audience' }, recipientCount: 5, sentCount: 5, failedCount: status === 'FAILED' ? 5 : status === 'PARTIALLY_SENT' ? 1 : 0, openedCount: 0, clickedCount: 0, engagement: 0, createdAt: '2026-10-08T02:00:00Z', sentAt: '2026-10-08T02:00:00Z' }));
campaigns.push({ ...campaigns[1], id: id(20), name: 'SMS lifecycle', type: 'SMS', status: 'SENDING' });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace('/api/v1', '');
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  fs.appendFileSync(requestsFile, JSON.stringify({ path: p, query: url.search, method: req.method, at: Date.now() }) + '\n');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  let data = [], meta = { total: 0, page: 1, limit: 25, hasMore: false };
  res.setHeader('Content-Type', 'application/json');
  if (p === '/auth/me') data = { user };
  else if (p === '/marketing/campaigns') {
    data = campaigns.map(row => row.id === id(11) && state.emailStatus ? { ...row, status: state.emailStatus } : row.id === id(20) && state.smsStatus ? { ...row, status: state.smsStatus } : row);
    if (url.searchParams.get('status')) data = data.filter(row => url.searchParams.get('status').split(',').includes(row.status));
    if (url.searchParams.get('search')) data = data.filter(row => row.name.toLowerCase().includes(url.searchParams.get('search').toLowerCase()));
    meta.total = data.length;
    if (req.method === 'POST') data = { ...body, ...campaigns[0], name: body.name, id: id(99) };
  } else if (/\/marketing\/campaigns\/[^/]+\/report/.test(p)) {
    const campaign = campaigns.find(row => p.includes(row.id)) || campaigns[1];
    const sms = campaign.type === 'SMS';
    const status = sms ? state.smsStatus || 'SENDING' : state.emailStatus || campaign.status;
    const delivered = status === 'DELIVERED';
    const clicked = !sms && !!state.clicked;
    data = { ...campaign, status, recipientCount: 1, sentCount: 1, deliveredCount: delivered ? 1 : 0, bouncedCount: 0, failedCount: status === 'FAILED' ? 1 : 0, openedCount: !sms && state.opened ? 1 : 0, clickedCount: clicked ? 1 : 0,
      recipients: [{ id: id(50), name: 'Controlled Recipient', email: sms ? null : 'recipient@example.test', phone: sms ? '+639171234567' : null, deliveryStatus: delivered ? 'Delivered' : status === 'SENT' ? 'Sent' : status === 'FAILED' ? 'Failed' : 'Submitted', opened: !sms && !!state.opened, clicked, lastActivity: clicked ? '2026-10-08T03:00:00Z' : '2026-10-08T02:00:00Z', failureReason: null }],
      topLinks: clicked ? [{ url: 'https://example.com/product', totalClicks: 3, uniqueClicks: 1, clickRate: 100, lastClicked: '2026-10-08T03:00:00Z' }] : [],
      sendResult: { campaignId: campaign.id, eligibleRecipients: 1, submittedRecipients: 1, failedRecipients: 0, status } };
  } else if (p === '/marketing/campaigns/metrics') data = { activeCampaigns: 1, sent: 25, emailSent: 20, opened: 0, clicked: 0 };
  else if (p === '/marketing/campaigns/sms-settings') data = { organizationEmail: null };
  else if (p === '/marketing/audiences/preview') data = { matched: 1, eligible: 1, recipients: [], meta, missingEmail: 0, invalidEmail: 0, duplicateEmail: 0, staffEmail: 0, unsubscribed: 0, blocked: 0, inactive: 0, recipientNotAllowed: 0 };
  else if (p.startsWith('/preferences/')) data = { columns: [], pageSize: 25, viewMode: 'wrap', sort: null, viewType: 'table' };
  else if (p === '/integrations/gmail/status') { res.end(JSON.stringify({ isConnected: false })); return; }
  res.end(JSON.stringify({ success: true, data, meta }));
});
server.listen(4109, '127.0.0.1', () => console.log('Campaign UI fixture listening at 127.0.0.1:4109'));
