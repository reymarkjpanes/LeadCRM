import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ImportListQuerySchema, ImportResultsQuerySchema, type CrmImportModule } from '@leadcrm/shared';
import { moduleImportService } from './imports.service';

/** Module URLs/permissions stay stable; every controller uses the same persistence. */
export function importController(module: CrmImportModule): Record<'createImport' | 'previewImport' | 'uploadCsv' | 'listImports' | 'getImport' | 'getImportResults', RequestHandler> {
  const service = moduleImportService(module);
  return {
    createImport: async (req, res, next) => {
      try {
        const data = await service.processImport(req.user!.tenantId, req.user!.userId, req.body);
        res.status(data.status === 'importing' ? 202 : 201).json({ success: true, data });
      } catch (error) { next(error); }
    },
    previewImport: async (req, res, next) => {
      try {
        const offset = z.coerce.number().int().min(0).max(5000).parse(req.query.offset ?? 0);
        const existing = await service.getRequestImport(req.user!.tenantId, req.user!.userId, req.body);
        const data = existing ? [] : await service.previewImport(req.user!.tenantId, req.user!.userId, req.body, offset);
        res.json({ success: true, data, import: existing });
      } catch (error) { next(error); }
    },
    uploadCsv: async (req, res, next) => {
      try { await service.uploadCsv(req.user!.tenantId, req.user!.userId, req.body); res.json({ success: true }); }
      catch (error) { next(error); }
    },
    listImports: async (req, res, next) => {
      try { res.json({ success: true, ...await service.listImports(req.user!.tenantId, ImportListQuerySchema.parse(req.query)) }); }
      catch (error) { next(error); }
    },
    getImport: async (req, res, next) => {
      try { res.json({ success: true, data: await service.getImportById(String(req.params.importId), req.user!.tenantId) }); }
      catch (error) { next(error); }
    },
    getImportResults: async (req, res, next) => {
      try { res.json({ success: true, ...await service.listImportResults(String(req.params.importId), req.user!.tenantId, ImportResultsQuerySchema.parse(req.query)) }); }
      catch (error) { next(error); }
    },
  };
}
