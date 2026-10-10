BEGIN;

-- Refuse ambiguous history or invalid authors; never rewrite historical rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "WorkflowExecutionStep" GROUP BY "executionId", "stepIndex" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Workflow migration blocked: duplicate execution step indexes require review.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Workflow" w LEFT JOIN "User" u ON u.id = w."activatedById" AND u."tenantId" = w."tenantId"
    WHERE w."activatedById" IS NOT NULL AND u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Workflow migration blocked: unavailable or cross-tenant activation authors require review.';
  END IF;
END $$;

ALTER TABLE "Workflow" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WorkflowExecutionRun" ADD COLUMN "workflowVersion" INTEGER, ADD COLUMN "definitionSnapshot" JSONB;
CREATE UNIQUE INDEX "WorkflowExecutionStep_executionId_stepIndex_key" ON "WorkflowExecutionStep" ("executionId", "stepIndex");
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_activatedById_tenantId_fkey"
  FOREIGN KEY ("activatedById", "tenantId") REFERENCES "User" ("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
