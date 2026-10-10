BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE "LeadDeal" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContactDeal" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
-- Preserve original scalar-only participants before switching all consumers.
INSERT INTO "LeadDeal" (id,"leadId","dealId","tenantId","addedAt")
SELECT gen_random_uuid()::text,"leadId",id,"tenantId","createdAt" FROM "Deal" WHERE "leadId" IS NOT NULL
ON CONFLICT ("leadId","dealId") DO NOTHING;
INSERT INTO "ContactDeal" (id,"contactId","dealId","tenantId","addedAt")
SELECT gen_random_uuid()::text,"contactId",id,"tenantId","createdAt" FROM "Deal" WHERE "contactId" IS NOT NULL
ON CONFLICT ("contactId","dealId") DO NOTHING;
WITH ranked AS (SELECT j.id, (row_number() OVER (PARTITION BY j."dealId" ORDER BY (j."leadId" IS NOT DISTINCT FROM d."leadId") DESC,j."addedAt",j.id)-1)::int AS position FROM "LeadDeal" j JOIN "Deal" d ON d.id=j."dealId")
UPDATE "LeadDeal" j SET position=r.position FROM ranked r WHERE r.id=j.id;
WITH ranked AS (SELECT j.id, (row_number() OVER (PARTITION BY j."dealId" ORDER BY (j."contactId" IS NOT DISTINCT FROM d."contactId") DESC,j."addedAt",j.id)-1)::int AS position FROM "ContactDeal" j JOIN "Deal" d ON d.id=j."dealId")
UPDATE "ContactDeal" j SET position=r.position FROM ranked r WHERE r.id=j.id;
INSERT INTO "TaskLead" ("taskId","leadId","tenantId",position) SELECT id,"leadId","tenantId",-1 FROM "Task" WHERE "leadId" IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO "TaskContact" ("taskId","contactId","tenantId",position) SELECT id,"contactId","tenantId",-1 FROM "Task" WHERE "contactId" IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO "TaskDeal" ("taskId","dealId","tenantId",position) SELECT id,"dealId","tenantId",-1 FROM "Task" WHERE "dealId" IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO "TaskAccount" ("taskId","accountId","tenantId",position) SELECT id,"accountId","tenantId",-1 FROM "Task" WHERE "accountId" IS NOT NULL ON CONFLICT DO NOTHING;

CREATE TABLE "MailboxThreadAssociation" (
  "accountId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailboxThreadAssociation_pkey" PRIMARY KEY ("accountId","threadId"),
  CONSTRAINT "MailboxThreadAssociation_accountId_tenantId_fkey" FOREIGN KEY ("accountId","tenantId") REFERENCES "EmailAccount"(id,"tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MailboxThreadAssociation_dealId_tenantId_fkey" FOREIGN KEY ("dealId","tenantId") REFERENCES "Deal"(id,"tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MailboxThreadAssociation_tenantId_dealId_idx" ON "MailboxThreadAssociation"("tenantId","dealId");
-- Invalid JSON, ambiguous keys or missing owners must abort instead of being lost.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "TenantPreference" p WHERE p.module='mailbox-thread' AND
    (jsonb_typeof(p.value)<>'object' OR (p.value - 'dealId' - 'linkedAt')<>'{}'::jsonb OR p.value->>'dealId' IS NULL OR p.value->>'linkedAt' IS NULL OR
     (SELECT count(*) FROM "EmailAccount" a WHERE a."tenantId"=p."tenantId" AND left(p.key,length(a.id)+1)=a.id||':')<>1)) THEN
    RAISE EXCEPTION 'Mailbox thread mapping requires reconciliation before normalization';
  END IF;
END $$;
INSERT INTO "MailboxThreadAssociation" ("accountId","threadId","tenantId","dealId","linkedAt")
SELECT a.id,substring(p.key FROM length(a.id)+2),p."tenantId",p.value->>'dealId',((p.value->>'linkedAt')::timestamptz AT TIME ZONE 'UTC')
FROM "TenantPreference" p JOIN "EmailAccount" a ON a."tenantId"=p."tenantId" AND left(p.key,length(a.id)+1)=a.id||':' WHERE p.module='mailbox-thread';

-- During the compatible rollout, old preference writes target the new relation;
-- the preference row is only a transport projection. Remove these bridges later.
CREATE FUNCTION crm_mailbox_preference_bridge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_id text; matching_accounts int;
BEGIN
  IF pg_trigger_depth()>1 OR NEW.module<>'mailbox-thread' THEN RETURN NEW; END IF;
  SELECT min(id),count(*) INTO account_id,matching_accounts FROM "EmailAccount" WHERE "tenantId"=NEW."tenantId" AND left(NEW.key,length(id)+1)=id||':';
  IF jsonb_typeof(NEW.value)<>'object' OR (NEW.value - 'dealId' - 'linkedAt')<>'{}'::jsonb OR matching_accounts<>1 OR NEW.value->>'dealId' IS NULL OR NEW.value->>'linkedAt' IS NULL THEN RAISE EXCEPTION 'Invalid mailbox thread mapping'; END IF;
  INSERT INTO "MailboxThreadAssociation" ("accountId","threadId","tenantId","dealId","linkedAt") VALUES
    (account_id,substring(NEW.key FROM length(account_id)+2),NEW."tenantId",NEW.value->>'dealId',((NEW.value->>'linkedAt')::timestamptz AT TIME ZONE 'UTC'))
  ON CONFLICT ("accountId","threadId") DO UPDATE SET "dealId"=EXCLUDED."dealId","linkedAt"=EXCLUDED."linkedAt";
  RETURN NEW;
END $$;
CREATE TRIGGER crm_mailbox_preference_bridge AFTER INSERT OR UPDATE ON "TenantPreference" FOR EACH ROW EXECUTE FUNCTION crm_mailbox_preference_bridge();
CREATE FUNCTION crm_mailbox_relation_bridge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
  INSERT INTO "TenantPreference" (id,"tenantId",module,key,value,"createdAt","updatedAt") VALUES
    (gen_random_uuid()::text,NEW."tenantId",'mailbox-thread',NEW."accountId"||':'||NEW."threadId",jsonb_build_object('dealId',NEW."dealId",'linkedAt',to_char(NEW."linkedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),now(),now())
  ON CONFLICT ("tenantId",module,key) DO UPDATE SET value=EXCLUDED.value,"updatedAt"=EXCLUDED."updatedAt";
  RETURN NEW;
END $$;
CREATE TRIGGER crm_mailbox_relation_bridge AFTER INSERT OR UPDATE ON "MailboxThreadAssociation" FOR EACH ROW EXECUTE FUNCTION crm_mailbox_relation_bridge();
WITH ranked AS (SELECT j."taskId",j."leadId",(row_number() OVER (PARTITION BY j."taskId" ORDER BY (j."leadId" IS NOT DISTINCT FROM p."leadId") DESC,j.position,j."leadId")-1)::int AS position FROM "TaskLead" j JOIN "Task" p ON p.id=j."taskId") UPDATE "TaskLead" j SET position=r.position FROM ranked r WHERE j."taskId"=r."taskId" AND j."leadId"=r."leadId";
WITH ranked AS (SELECT j."taskId",j."contactId",(row_number() OVER (PARTITION BY j."taskId" ORDER BY (j."contactId" IS NOT DISTINCT FROM p."contactId") DESC,j.position,j."contactId")-1)::int AS position FROM "TaskContact" j JOIN "Task" p ON p.id=j."taskId") UPDATE "TaskContact" j SET position=r.position FROM ranked r WHERE j."taskId"=r."taskId" AND j."contactId"=r."contactId";
WITH ranked AS (SELECT j."taskId",j."dealId",(row_number() OVER (PARTITION BY j."taskId" ORDER BY (j."dealId" IS NOT DISTINCT FROM p."dealId") DESC,j.position,j."dealId")-1)::int AS position FROM "TaskDeal" j JOIN "Task" p ON p.id=j."taskId") UPDATE "TaskDeal" j SET position=r.position FROM ranked r WHERE j."taskId"=r."taskId" AND j."dealId"=r."dealId";
WITH ranked AS (SELECT j."taskId",j."accountId",(row_number() OVER (PARTITION BY j."taskId" ORDER BY (j."accountId" IS NOT DISTINCT FROM p."accountId") DESC,j.position,j."accountId")-1)::int AS position FROM "TaskAccount" j JOIN "Task" p ON p.id=j."taskId") UPDATE "TaskAccount" j SET position=r.position FROM ranked r WHERE j."taskId"=r."taskId" AND j."accountId"=r."accountId";

-- Old releases can read these columns during rollout. Only junction changes
-- produce the projections; the retirement verifier rejects scalar-only writes.
CREATE FUNCTION crm_relationship_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id text;
BEGIN
  FOR parent_id IN SELECT DISTINCT value FROM unnest(ARRAY[to_jsonb(OLD)->>TG_ARGV[1],to_jsonb(NEW)->>TG_ARGV[1]]) value WHERE value IS NOT NULL LOOP
    EXECUTE format('UPDATE %I p SET %I=(SELECT %I FROM %I WHERE %I=$1 ORDER BY %s LIMIT 1) WHERE p.id=$1 AND p.%I IS DISTINCT FROM (SELECT %I FROM %I WHERE %I=$1 ORDER BY %s LIMIT 1)',
      TG_ARGV[0],TG_ARGV[2],TG_ARGV[2],TG_TABLE_NAME,TG_ARGV[1],TG_ARGV[3],TG_ARGV[2],TG_ARGV[2],TG_TABLE_NAME,TG_ARGV[1],TG_ARGV[3]) USING parent_id;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER crm_relationship_projection AFTER INSERT OR UPDATE OR DELETE ON "LeadDeal" FOR EACH ROW EXECUTE FUNCTION crm_relationship_projection('Deal','dealId','leadId','"position", "addedAt", id');
UPDATE "Deal" p SET "leadId"=(SELECT "leadId" FROM "LeadDeal" j WHERE j."dealId"=p.id ORDER BY "position", "addedAt", id LIMIT 1) WHERE p."leadId" IS DISTINCT FROM (SELECT "leadId" FROM "LeadDeal" j WHERE j."dealId"=p.id ORDER BY "position", "addedAt", id LIMIT 1);
CREATE TRIGGER crm_relationship_projection AFTER INSERT OR UPDATE OR DELETE ON "ContactDeal" FOR EACH ROW EXECUTE FUNCTION crm_relationship_projection('Deal','dealId','contactId','"position", "addedAt", id');
UPDATE "Deal" p SET "contactId"=(SELECT "contactId" FROM "ContactDeal" j WHERE j."dealId"=p.id ORDER BY "position", "addedAt", id LIMIT 1) WHERE p."contactId" IS DISTINCT FROM (SELECT "contactId" FROM "ContactDeal" j WHERE j."dealId"=p.id ORDER BY "position", "addedAt", id LIMIT 1);
CREATE TRIGGER crm_relationship_projection AFTER INSERT OR UPDATE OR DELETE ON "TaskLead" FOR EACH ROW EXECUTE FUNCTION crm_relationship_projection('Task','taskId','leadId','"position", "leadId"');
UPDATE "Task" p SET "leadId"=(SELECT "leadId" FROM "TaskLead" j WHERE j."taskId"=p.id ORDER BY "position", "leadId" LIMIT 1) WHERE p."leadId" IS DISTINCT FROM (SELECT "leadId" FROM "TaskLead" j WHERE j."taskId"=p.id ORDER BY "position", "leadId" LIMIT 1);
CREATE TRIGGER crm_relationship_projection AFTER INSERT OR UPDATE OR DELETE ON "TaskContact" FOR EACH ROW EXECUTE FUNCTION crm_relationship_projection('Task','taskId','contactId','"position", "contactId"');
UPDATE "Task" p SET "contactId"=(SELECT "contactId" FROM "TaskContact" j WHERE j."taskId"=p.id ORDER BY "position", "contactId" LIMIT 1) WHERE p."contactId" IS DISTINCT FROM (SELECT "contactId" FROM "TaskContact" j WHERE j."taskId"=p.id ORDER BY "position", "contactId" LIMIT 1);
CREATE TRIGGER crm_relationship_projection AFTER INSERT OR UPDATE OR DELETE ON "TaskDeal" FOR EACH ROW EXECUTE FUNCTION crm_relationship_projection('Task','taskId','dealId','"position", "dealId"');
UPDATE "Task" p SET "dealId"=(SELECT "dealId" FROM "TaskDeal" j WHERE j."taskId"=p.id ORDER BY "position", "dealId" LIMIT 1) WHERE p."dealId" IS DISTINCT FROM (SELECT "dealId" FROM "TaskDeal" j WHERE j."taskId"=p.id ORDER BY "position", "dealId" LIMIT 1);
CREATE TRIGGER crm_relationship_projection AFTER INSERT OR UPDATE OR DELETE ON "TaskAccount" FOR EACH ROW EXECUTE FUNCTION crm_relationship_projection('Task','taskId','accountId','"position", "accountId"');
UPDATE "Task" p SET "accountId"=(SELECT "accountId" FROM "TaskAccount" j WHERE j."taskId"=p.id ORDER BY "position", "accountId" LIMIT 1) WHERE p."accountId" IS DISTINCT FROM (SELECT "accountId" FROM "TaskAccount" j WHERE j."taskId"=p.id ORDER BY "position", "accountId" LIMIT 1);
-- Delete mappings consistently through either rollout representation.
CREATE FUNCTION crm_mailbox_delete_bridge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='MailboxThreadAssociation' THEN
    DELETE FROM "TenantPreference" WHERE "tenantId"=OLD."tenantId" AND module='mailbox-thread' AND key=OLD."accountId"||':'||OLD."threadId";
  ELSIF OLD.module='mailbox-thread' THEN
    DELETE FROM "MailboxThreadAssociation" WHERE "tenantId"=OLD."tenantId" AND "accountId"||':'||"threadId"=OLD.key;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER crm_mailbox_delete_bridge AFTER DELETE ON "MailboxThreadAssociation" FOR EACH ROW EXECUTE FUNCTION crm_mailbox_delete_bridge();
CREATE TRIGGER crm_mailbox_delete_bridge AFTER DELETE ON "TenantPreference" FOR EACH ROW EXECUTE FUNCTION crm_mailbox_delete_bridge();
COMMIT;
