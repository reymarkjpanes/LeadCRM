import sanitizeHtml from 'sanitize-html';
import { CAMPAIGN_EMAIL_TAGS, CAMPAIGN_EMAIL_ATTRIBUTES, linkifyCampaignHtml, renderEmailVariables, EmailSubjectSchema, type EmailVariables } from '@leadcrm/shared';
import { AppError } from '../../../shared/errors/app-error';

export function sanitizeCampaignHtml(body: string): string {
  return sanitizeHtml(body, {
    allowedTags: CAMPAIGN_EMAIL_TAGS,
    allowedAttributes: CAMPAIGN_EMAIL_ATTRIBUTES,
    allowedSchemes: ['https', 'http', 'mailto'], allowProtocolRelative: false,
  }).trim();
}
export function prepareCampaignHtml(body: string): string {
  return linkifyCampaignHtml(sanitizeCampaignHtml(body));
}
export function renderCampaignMessage(subject: string, body: string, values: EmailVariables) {
  const renderedSubject = EmailSubjectSchema.parse(renderEmailVariables(subject, values));
  if (!renderedSubject) throw new AppError('Personalized subject is empty.', 400);
  const html = prepareCampaignHtml(renderEmailVariables(body, values, true));
  if (!sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim()) throw new AppError('Body must contain message text.', 400);
  return { subject: renderedSubject, html };
}
