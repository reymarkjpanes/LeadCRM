import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedCampaignTemplates } from '../modules/marketing/templates/default-templates';

const db = new PrismaClient();
async function main() {
  const tenantId = process.argv[2];
  const tenants = await db.tenant.findMany({ where: tenantId ? { id: tenantId } : { name: { equals: 'Camxian Technologies', mode: 'insensitive' } }, select: { id: true, name: true } });
  if (tenants.length !== 1) throw new Error('Specify the confirmed Camxian workspace ID: npm run db:seed:campaigns -- <tenant-id>. No records were changed.');
  const created = await seedCampaignTemplates(db, tenants[0].id);
  console.info(`Campaign templates: ${created} created; ${6 - created} existing samples preserved.`);
}
main().catch(() => { console.error('Campaign template seed failed. Verify the workspace ID and database connection.'); process.exitCode = 1; }).finally(() => db.$disconnect());
