import prisma from '../../../config/database.config';
import { tenantContext } from '../../../core/tenant/tenant-context';

/** Upload deletion cascades chunks; job history survives with uploadId = null. */
export async function purgeExpiredImportUploads(now = new Date()) {
  return tenantContext.exit(async () => {
    const result = await prisma.crmImportUpload.deleteMany({ where: { expiresAt: { lte: now } } });
    return result.count;
  });
}

export function startImportCleanupScheduler() {
  let running = false;
  const purge = async () => {
    if (running) return;
    running = true;
    try { await purgeExpiredImportUploads(); }
    catch { console.error('[crm-import-cleanup] Cleanup failed; retrying at the next interval.'); }
    finally { running = false; }
  };
  void purge();
  const timer = setInterval(() => { void purge(); }, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
