import DOMPurify from 'dompurify';
import { CAMPAIGN_EMAIL_TAGS, CAMPAIGN_EMAIL_ATTRIBUTES, linkifyCampaignHtml, renderEmailVariables, type EmailVariables } from '@leadcrm/shared';

export function sanitizeCampaignBody(body: string): string {
  const html = DOMPurify.sanitize(body, { ALLOWED_TAGS: CAMPAIGN_EMAIL_TAGS,
    ALLOWED_ATTR: [...new Set(Object.values(CAMPAIGN_EMAIL_ATTRIBUTES).flat())], ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i });
  // DOMPurify's attribute list is global; apply the shared per-element policy.
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('*')) {
    const allowed = CAMPAIGN_EMAIL_ATTRIBUTES[element.tagName.toLowerCase() as keyof typeof CAMPAIGN_EMAIL_ATTRIBUTES] ?? [];
    for (const attribute of [...element.attributes]) if (!allowed.includes(attribute.name)) element.removeAttribute(attribute.name);
  }
  return template.innerHTML.trim();
}

export function renderCampaignPreview(body: string, variables: EmailVariables): string {
  return linkifyCampaignHtml(sanitizeCampaignBody(renderEmailVariables(body, variables, true)));
}

/** Persist the anchors that the preview shows so every sender receives HTML links. */
export function prepareCampaignBody(body: string): string {
  return linkifyCampaignHtml(sanitizeCampaignBody(body));
}
