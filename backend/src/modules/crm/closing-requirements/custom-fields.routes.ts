import { Router } from 'express';
import { CUSTOM_FIELD_MODULES, isClosedWonField } from '@leadcrm/shared';
import { authorize, authorizeAny } from '../../../api/middleware/rbac.middleware';
import { salesTransaction } from '../leads/lead-automation.service';
import { readFields } from './closing-requirements.repository';
import { readRecordValues, recordLinks, requireCustomFieldRecord } from './custom-field-values.repository';

export const customFieldsRouter = Router();
for (const module of CUSTOM_FIELD_MODULES) {
  customFieldsRouter.get(`/${module}/custom-fields`, authorizeAny(`${module}.view`, `${module}.create`, `${module}.edit`), async (req, res, next) => {
    try {
      const fields = await salesTransaction(async tx => (await readFields(tx, req.user!.tenantId)).filter(field => field.module === module && !isClosedWonField(field)));
      res.json({ success: true, data: fields });
    } catch (error) { next(error); }
  });
  customFieldsRouter.get(`/${module}/:id/custom-fields`, authorize(`${module}.view`), async (req, res, next) => {
    try {
      const tenantId = req.user!.tenantId, id = String(req.params.id);
      const data = await salesTransaction(async tx => {
        await requireCustomFieldRecord(tx, tenantId, module, id);
        const fields = (await readFields(tx, tenantId)).filter(field => field.module === module && !isClosedWonField(field));
        const values = await readRecordValues(tx, tenantId, module, id);
        const files = await tx.recordFile.findMany({ where: { tenantId, [recordLinks[module]]: id }, select: { id: true, name: true } });
        return { fields, values, files: files.map(file => ({ ...file, url: `/api/proxy/crm/${module}/${encodeURIComponent(id)}/files/${file.id}/download` })) };
      });
      res.json({ success: true, data });
    } catch (error) { next(error); }
  });
}
