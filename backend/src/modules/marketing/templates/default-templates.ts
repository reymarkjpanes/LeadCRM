import type { PrismaClient } from '@prisma/client';
import { MarketingTemplateSchema } from '@leadcrm/shared';

export const DEFAULT_CAMXIAN_TEMPLATES = [
  { name: 'Lead Inquiry Acknowledgment', type: 'Email', category: 'Sales', subject: 'Thanks for your inquiry, {{first_name}}', content: `Hi {{first_name}},

Thank you for reaching out to Camxian Technologies.

We received your inquiry and our team will review your requirements. A representative will contact you to discuss the appropriate solution for {{company_name}}.

If you have any questions in the meantime, please contact {{sender_name}} at {{sender_email}}.

Best regards,
{{sender_name}}
Camxian Technologies` },
  { name: 'Proposal Follow-Up', type: 'Email', category: 'Sales', subject: 'Following up on your proposal, {{first_name}}', content: `Hi {{first_name}},

We are following up regarding the proposal prepared for {{company_name}}.

Please let us know if you have any questions, revisions, or additional requirements that we should consider.

We would be happy to discuss the proposed solution with you.

Best regards,
{{sender_name}}
Camxian Technologies
{{sender_email}}` },
  { name: 'Thank You and Next Steps', type: 'Email', category: 'Sales', subject: 'Thank you, {{first_name}} — next steps with Camxian Technologies', content: `Hi {{first_name}},

Thank you for choosing Camxian Technologies.

Our team will coordinate the next steps with {{company_name}} and keep you informed as the project progresses.

If you need assistance, please contact {{sender_name}} at {{sender_email}}.

Best regards,
{{sender_name}}
Camxian Technologies` },
  { name: 'Inquiry Received', type: 'SMS', category: 'Sales', content: 'Hi {{first_name}}, thank you for your inquiry with Camxian Technologies. We received your request and our team will contact you shortly.' },
  { name: 'Inquiry Follow-Up', type: 'SMS', category: 'Sales', content: 'Hi {{first_name}}, we are following up regarding your inquiry with Camxian Technologies for {{company_name}}. Our team is ready to assist you.' },
  { name: 'Proposal Ready', type: 'SMS', category: 'Sales', content: 'Hi {{first_name}}, your requested proposal from Camxian Technologies is ready. Please check your email for the details.' },
] as const;

export async function seedCampaignTemplates(db: PrismaClient, tenantId: string) {
  return db.$transaction(async tx => {
    // Serialize concurrent seeds without adding a uniqueness constraint to user templates.
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
    let created = 0;
    for (const sample of DEFAULT_CAMXIAN_TEMPLATES) {
      // Archived and edited records keep their identity; never overwrite user content.
      if (await tx.template.findFirst({ where: { tenantId, name: sample.name, type: sample.type } })) continue;
      await tx.template.create({ data: { tenantId, ...MarketingTemplateSchema.parse(sample) } });
      created++;
    }
    return created;
  });
}
