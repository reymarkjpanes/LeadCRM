import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedCampaignTemplates, DEFAULT_CAMXIAN_TEMPLATES, DEFAULT_QUOTATION_TEMPLATES } from '../modules/marketing/templates/default-templates';

const db = new PrismaClient();
async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) throw new Error('Specify the confirmed workspace ID: npm run db:seed:campaigns -- <tenant-id>. No records were changed.');
  const tenants = await db.tenant.findMany({ where: { id: tenantId }, select: { id: true } });
  if (tenants.length !== 1) throw new Error('Workspace not found. No records were changed.');
  const created = await seedCampaignTemplates(db, tenants[0].id, true);
  console.info(`Campaign templates: ${created} created; ${DEFAULT_CAMXIAN_TEMPLATES.length + DEFAULT_QUOTATION_TEMPLATES.length - created} existing samples retained; legacy default variable tokens normalized.`);
}
main().catch(() => { console.error('Campaign template seed failed. Verify the workspace ID and database connection.'); process.exitCode = 1; }).finally(() => db.$disconnect());
