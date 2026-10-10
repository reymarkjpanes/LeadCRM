BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE "Deal", "Task", "LeadDeal", "ContactDeal", "TaskLead", "TaskContact", "TaskDeal", "TaskAccount", "TenantPreference", "MailboxThreadAssociation" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User") AND obj_description('"MailboxThreadAssociation"'::regclass,'pg_class') IS DISTINCT FROM 'canonical-crm-relations-api-verified-v1' THEN
    RAISE EXCEPTION 'Retirement blocked: verify the deployed canonical relationship release first';
  END IF;
END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Deal" p WHERE p."leadId" IS DISTINCT FROM (SELECT "leadId" FROM "LeadDeal" j WHERE j."dealId"=p.id ORDER BY "position", "addedAt", id LIMIT 1)) THEN RAISE EXCEPTION 'Retirement blocked: Deal.leadId differs from canonical relationships'; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Deal" p WHERE p."contactId" IS DISTINCT FROM (SELECT "contactId" FROM "ContactDeal" j WHERE j."dealId"=p.id ORDER BY "position", "addedAt", id LIMIT 1)) THEN RAISE EXCEPTION 'Retirement blocked: Deal.contactId differs from canonical relationships'; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Task" p WHERE p."leadId" IS DISTINCT FROM (SELECT "leadId" FROM "TaskLead" j WHERE j."taskId"=p.id ORDER BY "position", "leadId" LIMIT 1)) THEN RAISE EXCEPTION 'Retirement blocked: Task.leadId differs from canonical relationships'; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Task" p WHERE p."contactId" IS DISTINCT FROM (SELECT "contactId" FROM "TaskContact" j WHERE j."taskId"=p.id ORDER BY "position", "contactId" LIMIT 1)) THEN RAISE EXCEPTION 'Retirement blocked: Task.contactId differs from canonical relationships'; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Task" p WHERE p."dealId" IS DISTINCT FROM (SELECT "dealId" FROM "TaskDeal" j WHERE j."taskId"=p.id ORDER BY "position", "dealId" LIMIT 1)) THEN RAISE EXCEPTION 'Retirement blocked: Task.dealId differs from canonical relationships'; END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Task" p WHERE p."accountId" IS DISTINCT FROM (SELECT "accountId" FROM "TaskAccount" j WHERE j."taskId"=p.id ORDER BY "position", "accountId" LIMIT 1)) THEN RAISE EXCEPTION 'Retirement blocked: Task.accountId differs from canonical relationships'; END IF; END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "TenantPreference" p FULL JOIN "MailboxThreadAssociation" a ON p."tenantId"=a."tenantId" AND p.module='mailbox-thread' AND p.key=a."accountId"||':'||a."threadId" WHERE (p.module='mailbox-thread' OR a."accountId" IS NOT NULL) AND (a."accountId" IS NULL OR p.id IS NULL OR (p.value-'dealId'-'linkedAt')<>'{}'::jsonb OR p.value->>'dealId' IS DISTINCT FROM a."dealId" OR ((p.value->>'linkedAt')::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM a."linkedAt")) THEN
   RAISE EXCEPTION 'Retirement blocked: mailbox mapping equivalence failed';
 END IF;
END $$;
DROP TRIGGER crm_mailbox_preference_bridge ON "TenantPreference";
DROP TRIGGER crm_mailbox_relation_bridge ON "MailboxThreadAssociation";
DROP TRIGGER crm_mailbox_delete_bridge ON "TenantPreference";
DROP TRIGGER crm_mailbox_delete_bridge ON "MailboxThreadAssociation";
DROP FUNCTION crm_mailbox_preference_bridge();
DROP FUNCTION crm_mailbox_relation_bridge();
DROP FUNCTION crm_mailbox_delete_bridge();
DELETE FROM "TenantPreference" WHERE module='mailbox-thread';
DROP TRIGGER crm_relationship_projection ON "LeadDeal";
DROP TRIGGER crm_relationship_projection ON "ContactDeal";
DROP TRIGGER crm_relationship_projection ON "TaskLead";
DROP TRIGGER crm_relationship_projection ON "TaskContact";
DROP TRIGGER crm_relationship_projection ON "TaskDeal";
DROP TRIGGER crm_relationship_projection ON "TaskAccount";
DROP FUNCTION crm_relationship_projection();
DROP TRIGGER IF EXISTS "scope_leadId" ON "Deal";
ALTER TABLE "Deal" DROP COLUMN "leadId";
DROP TRIGGER IF EXISTS "scope_contactId" ON "Deal";
DROP TRIGGER IF EXISTS "scope_customerId" ON "Deal";
ALTER TABLE "Deal" DROP COLUMN "contactId";
DROP TRIGGER IF EXISTS "scope_leadId" ON "Task";
ALTER TABLE "Task" DROP COLUMN "leadId";
DROP TRIGGER IF EXISTS "scope_contactId" ON "Task";
DROP TRIGGER IF EXISTS "scope_customerId" ON "Task";
ALTER TABLE "Task" DROP COLUMN "contactId";
DROP TRIGGER IF EXISTS "scope_dealId" ON "Task";
ALTER TABLE "Task" DROP COLUMN "dealId";
DROP TRIGGER IF EXISTS "scope_accountId" ON "Task";
ALTER TABLE "Task" DROP COLUMN "accountId";
COMMENT ON TABLE "MailboxThreadAssociation" IS NULL;
-- A historical deployment retained a partial unique index with this name.
-- PostgreSQL already permits multiple NULL lead IDs in the full unique index;
-- replacing it preserves the rule and makes the physical catalog match Prisma.
DROP INDEX IF EXISTS "CampaignContact_campaignId_leadId_key";
CREATE UNIQUE INDEX "CampaignContact_campaignId_leadId_key" ON "CampaignContact"("campaignId", "leadId");
COMMIT;
