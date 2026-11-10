import { Prisma } from '@prisma/client';
import { tenantContext } from '../../../core/tenant/tenant-context';
import { AppError } from '../../../shared/errors/app-error';

const WORKFLOW_ADMISSION_SKIPPED = 'WORKFLOW_ADMISSION_SKIPPED';

export function isWorkflowAdmissionSkipped(error: unknown): error is AppError {
  return error instanceof AppError && error.code === WORKFLOW_ADMISSION_SKIPPED;
}

/** Share the workflow row lock until a dispatch or CRM effect commits. */
export async function assertWorkflowActionAdmission(
  tx: Prisma.TransactionClient,
  workflow: { id: string; tenantId: string; version?: number },
): Promise<void> {
  const scope = tenantContext.getStore();
  if (scope?.tenantId !== workflow.tenantId) throw new AppError('A matching CRM tenant context is required for automation.', 403);
  const version = workflow.version === undefined ? Prisma.empty : Prisma.sql`AND "version" = ${workflow.version}`;
  const rows = await tenantContext.exit(async () => await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Workflow"
    WHERE "id" = ${workflow.id} AND "tenantId" = ${workflow.tenantId}
      AND "isActive" = TRUE AND "status" = 'ACTIVE' AND "isArchived" = FALSE ${version}
    FOR SHARE
  `);
  if (!rows.length) throw new AppError('The workflow was paused, archived, or is no longer eligible to dispatch this event.', 409, WORKFLOW_ADMISSION_SKIPPED);
}
