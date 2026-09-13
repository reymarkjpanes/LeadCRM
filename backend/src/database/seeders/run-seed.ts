import { seedDemoAccounts } from './demo.seed';

async function main(): Promise<void> {
  console.log('[Seed] Running production seed...');
  const seededEmail = await seedDemoAccounts();
  console.log(`[Seed] Done. System Admin: ${seededEmail}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
