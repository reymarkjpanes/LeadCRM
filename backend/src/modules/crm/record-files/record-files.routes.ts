import { Router, raw } from 'express';
import { authorize } from '../../../api/middleware/rbac.middleware';
import { listFiles, uploadFile, downloadFile } from './record-files.service';

export const recordFilesRouter = Router();
// Mounted inside authenticated CRM routes; permissions run before the binary parser.
for (const module of ['leads', 'contacts', 'accounts', 'deals'] as const) {
  const permission = module;
  recordFilesRouter.get(`/${module}/:id/files`, authorize(`${permission}.view`), async (req, res, next) => {
    try { res.json({ success: true, data: await listFiles(module, String(req.params.id), req.user!.tenantId) }); } catch (error) { next(error); }
  });
  recordFilesRouter.post(`/${module}/:id/files`, authorize(`${permission}.edit`), raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res, next) => {
    try { res.status(201).json({ success: true, data: await uploadFile(module, String(req.params.id), req.user!.tenantId, req.user!.userId, req.query, req.body) }); } catch (error) { next(error); }
  });
  recordFilesRouter.get(`/${module}/:id/files/:fileId/download`, authorize(`${permission}.view`), async (req, res, next) => {
    try {
      const file = await downloadFile(module, String(req.params.id), req.user!.tenantId, String(req.params.fileId));
      res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(file.bytes);
    } catch (error) { next(error); }
  });
}
