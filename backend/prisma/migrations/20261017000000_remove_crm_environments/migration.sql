-- Deploy during a maintenance window with a verified database backup.
-- Keep PRODUCTION and tenant-wide rows byte-for-byte; remove only marked SANDBOX
-- rows and the five child tables that inherit their parent's dataset.
BEGIN;
CREATE TEMP TABLE _crm_remove (table_name text, row_data jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _crm_keep (table_name text, row_data jsonb) ON COMMIT DROP;
CREATE INDEX ON _crm_remove (table_name);
CREATE INDEX ON _crm_keep (table_name);
CREATE TEMP TABLE _crm_fks (table_name text, constraint_name text, definition text) ON COMMIT DROP;

DO $$
DECLARE t record; fk record; child record; join_sql text; unsafe boolean;
BEGIN
  -- Freeze the dataset while inspecting every incoming dependency and preserving rows.
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t.tablename);
  END LOOP;
  FOR t IN SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'environment' AND udt_name = 'CrmEnvironment'
  LOOP
    EXECUTE format('INSERT INTO _crm_remove SELECT %L, to_jsonb(r) FROM public.%I r WHERE environment = %L', t.table_name, t.table_name, 'SANDBOX');
  END LOOP;
  FOR child IN SELECT * FROM (VALUES
    ('TargetAudienceCondition', 'targetAudienceId', 'TargetAudience'),
    ('LeadImportResult', 'importId', 'LeadImport'),
    ('AccountImportResult', 'importId', 'AccountImport'),
    ('ContactImportResult', 'importId', 'ContactImport'),
    ('DealImportResult', 'importId', 'DealImport')
  ) AS c(table_name, parent_column, parent_table) LOOP
    EXECUTE format('INSERT INTO _crm_remove SELECT %L, to_jsonb(r) FROM public.%I r JOIN _crm_remove p ON p.table_name = %L AND r.%I = p.row_data->>''id''',
      child.table_name, child.table_name, child.parent_table, child.parent_column);
  END LOOP;
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('Environment', '_prisma_migrations') LOOP
    EXECUTE format('INSERT INTO _crm_keep SELECT %L, to_jsonb(r) FROM public.%I r WHERE NOT EXISTS (SELECT 1 FROM _crm_remove d WHERE d.table_name = %L AND d.row_data = to_jsonb(r))', t.tablename, t.tablename, t.tablename);
  END LOOP;

  -- Abort before deleting if ANY retained row references a row being retired.
  -- Inspect the catalog, including composite keys, rather than assuming CASCADE is safe.
  FOR fk IN SELECT c.*, source.relname AS child_table, target.relname AS parent_table,
      ns.nspname AS child_schema, nt.nspname AS parent_schema
    FROM pg_constraint c JOIN pg_class source ON source.oid = c.conrelid
    JOIN pg_class target ON target.oid = c.confrelid
    JOIN pg_namespace ns ON ns.oid = source.relnamespace
    JOIN pg_namespace nt ON nt.oid = target.relnamespace
    WHERE c.contype = 'f' AND nt.nspname = 'public'
  LOOP
    IF fk.child_schema <> 'public' THEN
      RAISE EXCEPTION 'Review external dependency %.% before retiring CRM datasets', fk.child_schema, fk.child_table;
    END IF;
    SELECT string_agg(format('(to_jsonb(r)->>%L) = (d.row_data->>%L)', ca.attname, pa.attname), ' AND ')
      INTO join_sql FROM unnest(fk.conkey, fk.confkey) AS k(child_att, parent_att)
      JOIN pg_attribute ca ON ca.attrelid = fk.conrelid AND ca.attnum = k.child_att
      JOIN pg_attribute pa ON pa.attrelid = fk.confrelid AND pa.attnum = k.parent_att;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I r JOIN _crm_remove d ON d.table_name = %L AND %s WHERE NOT EXISTS (SELECT 1 FROM _crm_remove x WHERE x.table_name = %L AND x.row_data = to_jsonb(r)))',
      fk.child_table, fk.parent_table, join_sql, fk.child_table) INTO unsafe;
    IF unsafe THEN RAISE EXCEPTION 'Retained data references obsolete Sandbox data through %.%; no records were removed', fk.child_table, fk.conname; END IF;
    -- Suspend FK actions so no cascading delete or SET NULL can change retained data.
    INSERT INTO _crm_fks VALUES (fk.child_table, fk.conname, pg_get_constraintdef(fk.oid));
  END LOOP;
  FOR fk IN SELECT * FROM _crm_fks LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', fk.table_name, fk.constraint_name);
  END LOOP;
  FOR t IN SELECT DISTINCT table_name FROM _crm_remove LOOP
    EXECUTE format('DELETE FROM public.%I r USING _crm_remove d WHERE d.table_name = %L AND d.row_data = to_jsonb(r)', t.table_name, t.table_name);
  END LOOP;
  FOR fk IN SELECT * FROM _crm_fks LOOP
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', fk.table_name, fk.constraint_name, fk.definition);
  END LOOP;
  -- Compare full row multisets, not only counts or IDs; any unexpected side effect rolls back.
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('Environment', '_prisma_migrations') LOOP
    EXECUTE format('SELECT EXISTS ((SELECT row_data FROM _crm_keep WHERE table_name = %L EXCEPT ALL SELECT to_jsonb(r) FROM public.%I r) UNION ALL (SELECT to_jsonb(r) FROM public.%I r EXCEPT ALL SELECT row_data FROM _crm_keep WHERE table_name = %L))', t.tablename, t.tablename, t.tablename, t.tablename) INTO unsafe;
    IF unsafe THEN RAISE EXCEPTION 'Retained data changed in %; rolling back', t.tablename; END IF;
  END LOOP;
END $$;

-- Keep the database's existing tenant immutability and relationship guards.
CREATE OR REPLACE FUNCTION crm_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" THEN
  RAISE EXCEPTION 'CRM records cannot move between tenants' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION crm_check_relation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_scope record; child_scope record; parent_id text;
BEGIN
 parent_id := to_jsonb(NEW)->>TG_ARGV[0];
 IF parent_id IS NULL THEN RETURN NEW; END IF;
 EXECUTE format('SELECT "tenantId" FROM %I WHERE id = $1', TG_ARGV[1]) INTO parent_scope USING parent_id;
 IF TG_NARGS = 2 THEN
  IF parent_scope."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
   RAISE EXCEPTION 'CRM relationship crosses tenant' USING ERRCODE = '23514';
  END IF;
 ELSE
  EXECUTE format('SELECT "tenantId" FROM %I WHERE id = $1', TG_ARGV[3]) INTO child_scope USING to_jsonb(NEW)->>TG_ARGV[2];
  IF parent_scope."tenantId" IS DISTINCT FROM child_scope."tenantId" THEN
   RAISE EXCEPTION 'CRM child relationship crosses tenant' USING ERRCODE = '23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Preserve the production assignment cursor under its single-workspace key.
-- An unexpected existing key must be reviewed rather than overwritten.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "TenantPreference" p JOIN "TenantPreference" q USING ("tenantId", module)
   WHERE p.module = 'lead-assignment' AND p.key = 'PRODUCTION' AND q.key = 'default') THEN
   RAISE EXCEPTION 'Review existing lead-assignment default preference before migrating';
 END IF;
END $$;
DELETE FROM "TenantPreference" WHERE module = 'lead-assignment' AND key = 'SANDBOX';
UPDATE "TenantPreference" SET key = 'default' WHERE module = 'lead-assignment' AND key = 'PRODUCTION';

-- DropForeignKey
ALTER TABLE "Environment" DROP CONSTRAINT "Environment_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "TaskLead" DROP CONSTRAINT "TaskLead_taskId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "TaskLead" DROP CONSTRAINT "TaskLead_leadId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "TaskContact" DROP CONSTRAINT "TaskContact_taskId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "TaskContact" DROP CONSTRAINT "TaskContact_contactId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "TaskDeal" DROP CONSTRAINT "TaskDeal_taskId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "TaskDeal" DROP CONSTRAINT "TaskDeal_dealId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "TaskAccount" DROP CONSTRAINT "TaskAccount_taskId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "TaskAccount" DROP CONSTRAINT "TaskAccount_accountId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "RecordFile" DROP CONSTRAINT "RecordFile_dealId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "RecordFile" DROP CONSTRAINT "RecordFile_leadId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "RecordFile" DROP CONSTRAINT "RecordFile_contactId_tenantId_environment_fkey";

-- DropForeignKey
ALTER TABLE "RecordFile" DROP CONSTRAINT "RecordFile_accountId_tenantId_environment_fkey";

-- DropIndex
DROP INDEX "Account_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Account_id_tenantId_environment_key";

-- DropIndex
DROP INDEX "Lead_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Lead_tenantId_environment_creationKey_key";

-- DropIndex
DROP INDEX "Lead_id_tenantId_environment_key";

-- DropIndex
DROP INDEX "Contact_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Contact_id_tenantId_environment_key";

-- DropIndex
DROP INDEX "Pipeline_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Stage_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Deal_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Deal_tenantId_environment_automationKey_key";

-- DropIndex
DROP INDEX "Deal_id_tenantId_environment_key";

-- DropIndex
DROP INDEX "LeadDeal_tenantId_environment_idx";

-- DropIndex
DROP INDEX "ContactDeal_tenantId_environment_idx";

-- DropIndex
DROP INDEX "DealStageHistory_tenantId_environment_idx";

-- DropIndex
DROP INDEX "DealAction_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Task_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Task_id_tenantId_environment_key";

-- DropIndex
DROP INDEX "Activity_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Notification_tenantId_environment_idx";

-- DropIndex
DROP INDEX "TargetAudience_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Campaign_tenantId_environment_idx";

-- DropIndex
DROP INDEX "MarketingForm_tenantId_environment_idx";

-- DropIndex
DROP INDEX "FormSubmission_tenantId_environment_formId_submittedAt_idx";

-- DropIndex
DROP INDEX "CampaignMetrics_tenantId_environment_idx";

-- DropIndex
DROP INDEX "CampaignContact_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Template_tenantId_environment_idx";

-- DropIndex
DROP INDEX "Workflow_tenantId_environment_idx";

-- DropIndex
DROP INDEX "WorkflowTriggerRecord_tenantId_environment_idx";

-- DropIndex
DROP INDEX "workflow_event_once";

-- DropIndex
DROP INDEX "WorkflowExecutionRun_tenantId_environment_idx";

-- DropIndex
DROP INDEX "WorkflowExecutionStep_tenantId_environment_idx";

-- DropIndex
DROP INDEX "EmailDeliveryLog_tenantId_environment_idx";

-- DropIndex
DROP INDEX "SMSQueue_tenantId_environment_idx";

-- DropIndex
DROP INDEX "EmailEvent_tenantId_environment_idx";

-- DropIndex
DROP INDEX "AutomationRule_tenantId_environment_idx";

-- DropIndex
DROP INDEX "LeadImport_tenantId_environment_idx";

-- DropIndex
DROP INDEX "AccountImport_tenantId_environment_idx";

-- DropIndex
DROP INDEX "ContactImport_tenantId_environment_idx";

-- DropIndex
DROP INDEX "DealImport_tenantId_environment_idx";

-- DropIndex
DROP INDEX "TaskLead_tenantId_environment_leadId_idx";

-- DropIndex
DROP INDEX "TaskContact_tenantId_environment_contactId_idx";

-- DropIndex
DROP INDEX "TaskDeal_tenantId_environment_dealId_idx";

-- DropIndex
DROP INDEX "TaskAccount_tenantId_environment_accountId_idx";

-- DropIndex
DROP INDEX "RecordFile_tenantId_environment_dealId_idx";

-- DropIndex
DROP INDEX "RecordFile_tenantId_environment_leadId_idx";

-- DropIndex
DROP INDEX "RecordFile_tenantId_environment_contactId_idx";

-- DropIndex
DROP INDEX "RecordFile_tenantId_environment_accountId_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "activeEnvironment";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Lead" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Contact" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Pipeline" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Stage" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Deal" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "LeadDeal" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "ContactDeal" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "DealStageHistory" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "DealAction" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Activity" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "TargetAudience" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "MarketingForm" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "FormSubmission" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "CampaignMetrics" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "CampaignContact" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Template" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "Workflow" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "WorkflowTriggerRecord" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "WorkflowExecutionRun" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "WorkflowExecutionStep" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "EmailDeliveryLog" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "SMSQueue" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "EmailEvent" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "AutomationRule" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "LeadImport" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "AccountImport" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "ContactImport" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "DealImport" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "TaskLead" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "TaskContact" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "TaskDeal" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "TaskAccount" DROP COLUMN "environment";

-- AlterTable
ALTER TABLE "RecordFile" DROP COLUMN "environment";

-- DropTable
DROP TABLE "Environment";

-- DropEnum
DROP TYPE "CrmEnvironment";

-- CreateIndex
CREATE INDEX "Account_tenantId_idx" ON "Account"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_id_tenantId_key" ON "Account"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Lead_tenantId_idx" ON "Lead"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_tenantId_creationKey_key" ON "Lead"("tenantId", "creationKey");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_id_tenantId_key" ON "Lead"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Contact_tenantId_idx" ON "Contact"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_tenantId_key" ON "Contact"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Pipeline_tenantId_idx" ON "Pipeline"("tenantId");

-- CreateIndex
CREATE INDEX "Stage_tenantId_idx" ON "Stage"("tenantId");

-- CreateIndex
CREATE INDEX "Deal_tenantId_idx" ON "Deal"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_tenantId_automationKey_key" ON "Deal"("tenantId", "automationKey");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_id_tenantId_key" ON "Deal"("id", "tenantId");

-- CreateIndex
CREATE INDEX "LeadDeal_tenantId_idx" ON "LeadDeal"("tenantId");

-- CreateIndex
CREATE INDEX "ContactDeal_tenantId_idx" ON "ContactDeal"("tenantId");

-- CreateIndex
CREATE INDEX "DealStageHistory_tenantId_idx" ON "DealStageHistory"("tenantId");

-- CreateIndex
CREATE INDEX "DealAction_tenantId_idx" ON "DealAction"("tenantId");

-- CreateIndex
CREATE INDEX "Task_tenantId_idx" ON "Task"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_tenantId_key" ON "Task"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Activity_tenantId_idx" ON "Activity"("tenantId");

-- CreateIndex
CREATE INDEX "Notification_tenantId_idx" ON "Notification"("tenantId");

-- CreateIndex
CREATE INDEX "TargetAudience_tenantId_idx" ON "TargetAudience"("tenantId");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_idx" ON "Campaign"("tenantId");

-- CreateIndex
CREATE INDEX "MarketingForm_tenantId_idx" ON "MarketingForm"("tenantId");

-- CreateIndex
CREATE INDEX "FormSubmission_tenantId_formId_submittedAt_idx" ON "FormSubmission"("tenantId", "formId", "submittedAt");

-- CreateIndex
CREATE INDEX "CampaignMetrics_tenantId_idx" ON "CampaignMetrics"("tenantId");

-- CreateIndex
CREATE INDEX "CampaignContact_tenantId_idx" ON "CampaignContact"("tenantId");

-- CreateIndex
CREATE INDEX "Template_tenantId_idx" ON "Template"("tenantId");

-- CreateIndex
CREATE INDEX "Workflow_tenantId_idx" ON "Workflow"("tenantId");

-- CreateIndex
CREATE INDEX "WorkflowTriggerRecord_tenantId_idx" ON "WorkflowTriggerRecord"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_event_once" ON "WorkflowTriggerRecord"("tenantId", "workflowId", "eventId");

-- CreateIndex
CREATE INDEX "WorkflowExecutionRun_tenantId_idx" ON "WorkflowExecutionRun"("tenantId");

-- CreateIndex
CREATE INDEX "WorkflowExecutionStep_tenantId_idx" ON "WorkflowExecutionStep"("tenantId");

-- CreateIndex
CREATE INDEX "EmailDeliveryLog_tenantId_idx" ON "EmailDeliveryLog"("tenantId");

-- CreateIndex
CREATE INDEX "SMSQueue_tenantId_idx" ON "SMSQueue"("tenantId");

-- CreateIndex
CREATE INDEX "EmailEvent_tenantId_idx" ON "EmailEvent"("tenantId");

-- CreateIndex
CREATE INDEX "AutomationRule_tenantId_idx" ON "AutomationRule"("tenantId");

-- CreateIndex
CREATE INDEX "LeadImport_tenantId_idx" ON "LeadImport"("tenantId");

-- CreateIndex
CREATE INDEX "AccountImport_tenantId_idx" ON "AccountImport"("tenantId");

-- CreateIndex
CREATE INDEX "ContactImport_tenantId_idx" ON "ContactImport"("tenantId");

-- CreateIndex
CREATE INDEX "DealImport_tenantId_idx" ON "DealImport"("tenantId");

-- CreateIndex
CREATE INDEX "TaskLead_tenantId_leadId_idx" ON "TaskLead"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "TaskContact_tenantId_contactId_idx" ON "TaskContact"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "TaskDeal_tenantId_dealId_idx" ON "TaskDeal"("tenantId", "dealId");

-- CreateIndex
CREATE INDEX "TaskAccount_tenantId_accountId_idx" ON "TaskAccount"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "RecordFile_tenantId_dealId_idx" ON "RecordFile"("tenantId", "dealId");

-- CreateIndex
CREATE INDEX "RecordFile_tenantId_leadId_idx" ON "RecordFile"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "RecordFile_tenantId_contactId_idx" ON "RecordFile"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "RecordFile_tenantId_accountId_idx" ON "RecordFile"("tenantId", "accountId");

-- AddForeignKey
ALTER TABLE "TaskLead" ADD CONSTRAINT "TaskLead_taskId_tenantId_fkey" FOREIGN KEY ("taskId", "tenantId") REFERENCES "Task"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLead" ADD CONSTRAINT "TaskLead_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskContact" ADD CONSTRAINT "TaskContact_taskId_tenantId_fkey" FOREIGN KEY ("taskId", "tenantId") REFERENCES "Task"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskContact" ADD CONSTRAINT "TaskContact_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDeal" ADD CONSTRAINT "TaskDeal_taskId_tenantId_fkey" FOREIGN KEY ("taskId", "tenantId") REFERENCES "Task"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDeal" ADD CONSTRAINT "TaskDeal_dealId_tenantId_fkey" FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAccount" ADD CONSTRAINT "TaskAccount_taskId_tenantId_fkey" FOREIGN KEY ("taskId", "tenantId") REFERENCES "Task"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAccount" ADD CONSTRAINT "TaskAccount_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_dealId_tenantId_fkey" FOREIGN KEY ("dealId", "tenantId") REFERENCES "Deal"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordFile" ADD CONSTRAINT "RecordFile_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
