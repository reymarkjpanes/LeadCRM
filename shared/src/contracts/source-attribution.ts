import { z } from 'zod';

const value = z.string().trim().max(200).refine(v => !/[\x00-\x1f\x7f-\x9f]/.test(v), 'Control characters are not allowed.');
export const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid'] as const;
export const AttributionTouchSchema = z.object({
  params: z.record(z.enum(ATTRIBUTION_KEYS), value).default({}),
  // Origins and paths only: never persist arbitrary URL queries or fragments.
  landingPage: z.string().max(2000).url().refine(v => { const u = new URL(v); return /^https?:$/.test(u.protocol) && !u.username && !u.password && !u.search && !u.hash; }).optional(),
  referrer: z.string().max(300).url().refine(v => { const u = new URL(v); return /^https?:$/.test(u.protocol) && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password; }).optional(),
  observedAt: z.string().datetime(),
}).strict();
export const AttributionContextSchema = z.object({ first: AttributionTouchSchema, last: AttributionTouchSchema, storage: z.enum(['session', 'remembered', 'unavailable']).default('session') }).strict();
export type AttributionTouch = z.infer<typeof AttributionTouchSchema>;
export type AttributionContext = z.infer<typeof AttributionContextSchema>;
export type SourceEvidence = {
  source: string; medium: string; campaign: string; category: string; channel: string;
  method: 'url_tags' | 'click_id' | 'referrer' | 'unattributed' | 'manual' | 'business_email';
  observedAt: string; landingPage?: string; referrer?: string;
};
export interface SourceAttribution { first: SourceEvidence; last: SourceEvidence; captureMethod: 'public_form' | 'manual' | 'business_email'; }

const hostIs = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);
/** URL tags describe a campaign; they do not authenticate an ad platform or visitor. */
export function classifySource(touch: AttributionTouch): SourceEvidence {
  const p = touch.params, source = (p.utm_source || '').trim().toLowerCase(), medium = (p.utm_medium || '').trim().toLowerCase();
  const base = { source, medium, campaign: p.utm_campaign || '', observedAt: touch.observedAt, landingPage: touch.landingPage, referrer: touch.referrer };
  if (source || medium) {
    let category = 'Others', channel = 'Unassigned';
    if (['email', 'newsletter'].includes(medium)) { category = 'Email Campaign'; channel = 'Email'; }
    else if (['paid_social', 'social_paid', 'paidsocial'].includes(medium)) { category = 'Social Media Advertisement'; channel = 'Paid Social'; }
    else if (['cpc', 'ppc', 'paid_search'].includes(medium)) { category = ['google', 'googleads', 'google_ads'].includes(source) ? 'Google Ads' : 'Others'; channel = 'Paid Search'; }
    else if (['direct_mail', 'print', 'flyer'].includes(medium)) { category = 'Direct Mail'; channel = 'Offline'; }
    else if (['content', 'content_marketing', 'article'].includes(medium)) { category = 'Content Marketing'; channel = 'Content'; }
    else if (['referral', 'partner'].includes(medium)) { category = 'Referral'; channel = 'Referral'; }
    else if (['social', 'organic_social'].includes(medium)) channel = 'Organic Social';
    else if (medium === 'organic') channel = 'Organic Search';
    else if (medium === 'sms') channel = 'SMS';
    else if (medium === 'website') { category = 'Website'; channel = 'Website'; }
    else if (medium === 'offline') channel = 'Offline';
    else if (['display', 'banner'].includes(medium)) channel = 'Display';
    return { ...base, category, channel, method: 'url_tags' };
  }
  if (p.gclid || p.gbraid || p.wbraid) return { ...base, source: 'google', medium: 'paid', category: 'Google Ads', channel: 'Paid Other', method: 'click_id' };
  if (p.msclkid) return { ...base, source: 'bing', medium: 'paid', category: 'Others', channel: 'Paid Other', method: 'click_id' };
  if (touch.referrer) {
    const host = new URL(touch.referrer).hostname.toLowerCase();
    if (touch.landingPage && host === new URL(touch.landingPage).hostname.toLowerCase()) return { ...base, source: 'unattributed', medium: 'none', category: 'Website', channel: 'Direct / Unattributed', method: 'unattributed' };
    const search = ['google.com', 'google.com.ph', 'bing.com', 'search.yahoo.com', 'duckduckgo.com'].some(domain => hostIs(host, domain));
    const social = ['facebook.com', 'instagram.com', 't.co', 'linkedin.com', 'tiktok.com', 'youtube.com'].some(domain => hostIs(host, domain));
    return { ...base, source: host, medium: search ? 'organic' : social ? 'social' : 'referral', category: search || social ? 'Website' : 'Referral', channel: search ? 'Organic Search' : social ? 'Organic Social' : 'Referral', method: 'referrer' };
  }
  return { ...base, source: p.fbclid ? 'facebook (unclassified)' : 'unattributed', medium: 'none', category: 'Website', channel: 'Direct / Unattributed', method: 'unattributed' };
}
export function sourceAttribution(context?: AttributionContext, now = new Date()): SourceAttribution {
  const empty: AttributionTouch = { params: {}, observedAt: now.toISOString() };
  const valid = (touch: AttributionTouch) => { const age = +now - Date.parse(touch.observedAt); return age >= -300000 && age <= 30 * 86400000; };
  const first = context && valid(context.first) ? context.first : empty, last = context && valid(context.last) ? context.last : empty;
  return { first: classifySource(first), last: classifySource(last), captureMethod: 'public_form' };
}
export const SOURCE_LINK_PRESETS = [
  { category: 'Google Ads', source: 'google', medium: 'cpc' },
  { category: 'Social Media Advertisement', source: 'facebook', medium: 'paid_social' },
  { category: 'Social Media Advertisement', source: 'instagram', medium: 'paid_social' },
  { category: 'Email Campaign', source: 'newsletter', medium: 'email' },
  { category: 'Referral', source: 'partner', medium: 'referral' },
  { category: 'Website', source: 'company_website', medium: 'website' },
  { category: 'Content Marketing', source: 'article', medium: 'content_marketing' },
  { category: 'Others', source: 'event', medium: 'offline' },
] as const;
export function sourceCampaignLink(base: string, source: string, medium: string, campaign = ''): string {
  const url = new URL(base);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS form URL.');
  for (const key of ATTRIBUTION_KEYS) url.searchParams.delete(key);
  url.searchParams.set('utm_source', source); url.searchParams.set('utm_medium', medium);
  if (campaign) url.searchParams.set('utm_campaign', campaign);
  return url.toString();
}
export const BUSINESS_INQUIRY_EMAIL = 'leadcrm.tech@gmail.com';
export const BUSINESS_INQUIRY_MAILTO = `mailto:${BUSINESS_INQUIRY_EMAIL}?subject=Product%20inquiry`;
