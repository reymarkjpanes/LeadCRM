-- Additive migration. Existing Notification IDs, read state and timestamps are retained.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
CREATE TABLE "NotificationEvent" (
 "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id"),
 "eventKey" TEXT NOT NULL, "type" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL,
 "ownerId" TEXT, "actorId" TEXT, "admins" BOOLEAN NOT NULL DEFAULT false,
 "payload" JSONB NOT NULL DEFAULT '{}',
 "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "attempts" INTEGER NOT NULL DEFAULT 0,
 "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "processedAt" TIMESTAMP(3), "lastError" TEXT
);
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_type_check" CHECK (type IN (
 'lead_assigned','contact_assigned','account_assigned','deal_assigned','task_assigned',
 'customer_hot','customer_cold','customer_cancelled','deal_progressed','deal_won','deal_lost',
 'closing_requirements_needed','closing_requirements_completed','task_due','task_overdue','customer_reply',
 'campaign_failed','workflow_failed','user_created','user_status_changed','mailbox_disconnected','mailbox_sync_failed',
 'form_processing_failed','record_archived','record_restored'));
CREATE UNIQUE INDEX "NotificationEvent_tenantId_eventKey_key" ON "NotificationEvent"("tenantId","eventKey");
CREATE INDEX "NotificationEvent_tenantId_processedAt_availableAt_id_idx" ON "NotificationEvent"("tenantId","processedAt","availableAt","id");
CREATE INDEX "NotificationEvent_processedAt_availableAt_tenantId_idx" ON "NotificationEvent"("processedAt","availableAt","tenantId");
CREATE TABLE "NotificationDelivery" (
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id"), "userId" TEXT NOT NULL, "eventKey" TEXT NOT NULL,
 "outcome" TEXT NOT NULL DEFAULT 'delivered', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("tenantId","userId","eventKey"),
 FOREIGN KEY ("userId","tenantId") REFERENCES "User"("id","tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_outcome_check"
 CHECK (outcome IN ('delivered','deleted','disabled','ineligible','legacy_baseline'));
ALTER TABLE "Notification" ADD COLUMN "occurredAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "notificationVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Campaign" ADD COLUMN "notificationRunVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailAccount" ADD COLUMN "notificationIncidentId" TEXT, ADD COLUMN "notificationFailedAt" TIMESTAMP(3);
CREATE INDEX "Notification_tenantId_userId_createdAt_id_idx" ON "Notification"("tenantId","userId","createdAt","id");
CREATE INDEX "Notification_tenantId_userId_isRead_createdAt_id_idx" ON "Notification"("tenantId","userId","isRead","createdAt","id");
INSERT INTO "NotificationDelivery" ("tenantId","userId","eventKey","createdAt")
 SELECT "tenantId","userId","eventKey","createdAt" FROM "Notification" WHERE "eventKey" IS NOT NULL
 ON CONFLICT DO NOTHING;

-- Preserve identity even when older application instances insert/delete during rollout.
CREATE FUNCTION crm_notification_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF OLD."eventKey" IS NOT NULL THEN
     INSERT INTO "NotificationDelivery" ("tenantId","userId","eventKey","outcome")
       VALUES (OLD."tenantId",OLD."userId",OLD."eventKey",'deleted')
       ON CONFLICT ("tenantId","userId","eventKey") DO UPDATE SET outcome='deleted';
   END IF;
   RETURN OLD;
 END IF;
 IF NEW."eventKey" IS NOT NULL THEN
   INSERT INTO "NotificationDelivery" ("tenantId","userId","eventKey")
     VALUES (NEW."tenantId",NEW."userId",NEW."eventKey") ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_identity_insert AFTER INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION crm_notification_identity();
CREATE TRIGGER crm_notification_identity_delete BEFORE DELETE ON "Notification" FOR EACH ROW EXECUTE FUNCTION crm_notification_identity();

-- Older application instances must also respect tombstones during a rolling release.
CREATE FUNCTION crm_notification_replay_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."eventKey" IS NOT NULL AND EXISTS (
   SELECT 1 FROM "NotificationDelivery" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."userId"
     AND "eventKey"=NEW."eventKey" AND outcome IN ('deleted','disabled','ineligible','legacy_baseline')
 ) THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_replay_guard BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION crm_notification_replay_guard();

CREATE FUNCTION crm_enqueue_notification(t text,k text,kind text,entity text,eid text,owner_id text DEFAULT NULL,
 admin_alert boolean DEFAULT false,actor_id text DEFAULT NULL,facts jsonb DEFAULT '{}',due timestamp DEFAULT CURRENT_TIMESTAMP)
RETURNS void LANGUAGE sql AS $$
 INSERT INTO "NotificationEvent" ("tenantId","eventKey","type","entityType","entityId","ownerId","admins","actorId","payload","availableAt")
 VALUES (t,k,kind,entity,eid,owner_id,admin_alert,actor_id,facts,due) ON CONFLICT ("tenantId","eventKey") DO NOTHING;
$$;

-- Database occurrence identity covers direct, workflow, import, batch and deactivation writes.
-- Only structured transitions enter the outbox; display titles are never parsed.
CREATE FUNCTION crm_notification_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n jsonb := to_jsonb(NEW); o jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 t text := n->>'tenantId'; eid text := n->>'id'; source_id text := gen_random_uuid()::text;
 actor_id text := nullif(current_setting('leadcrm.actor_id',true),''); owner_id text := n->>'assignedUserId';
 admin_alert boolean := false;
BEGIN
 IF actor_id IS NULL AND TG_OP='INSERT' THEN actor_id := coalesce(n->>'createdById',n->>'ownerId',n->>'assignedById'); END IF;
 IF TG_TABLE_NAME IN ('Lead','Contact','Account','Deal','Task') THEN
   IF owner_id IS NOT NULL AND (TG_OP='INSERT' OR o->>'assignedUserId' IS DISTINCT FROM owner_id) THEN
     admin_alert := TG_TABLE_NAME='Lead' AND TG_OP='INSERT' AND lower(coalesce(n->>'source','')) IN ('website','form','website form');
     PERFORM crm_enqueue_notification(t,CASE WHEN TG_OP='INSERT' THEN lower(TG_TABLE_NAME)||':created:'||eid ELSE 'assignment:'||source_id END,
       lower(TG_TABLE_NAME)||'_assigned',TG_TABLE_NAME,eid,owner_id,admin_alert,actor_id);
   ELSIF TG_TABLE_NAME='Lead' AND TG_OP='INSERT' AND lower(coalesce(n->>'source','')) IN ('website','form','website form') THEN
     PERFORM crm_enqueue_notification(t,'lead:created:'||eid,'lead_assigned','Lead',eid,NULL,true,actor_id);
   END IF;
 END IF;
 IF TG_TABLE_NAME IN ('Lead','Contact') AND TG_OP='UPDATE' AND n->>'status' IS DISTINCT FROM o->>'status'
    AND upper(n->>'status') IN ('HOT','COLD','CANCELLED') THEN
   PERFORM crm_enqueue_notification(t,'status:'||source_id,'customer_'||lower(n->>'status'),TG_TABLE_NAME,eid,
     owner_id,upper(n->>'status') IN ('HOT','CANCELLED'),NULL,jsonb_build_object('status',n->>'status'));
 END IF;
 IF TG_TABLE_NAME='User' AND (TG_OP='INSERT' OR n->>'status' IS DISTINCT FROM o->>'status') THEN
   PERFORM crm_enqueue_notification(t,'user:'||source_id,CASE WHEN TG_OP='INSERT' THEN 'user_created' ELSE 'user_status_changed' END,
     'User',eid,NULL,true,NULL,jsonb_build_object('status',n->>'status'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_record AFTER INSERT OR UPDATE ON "Lead" FOR EACH ROW EXECUTE FUNCTION crm_notification_record();
CREATE TRIGGER crm_notification_record AFTER INSERT OR UPDATE ON "Contact" FOR EACH ROW EXECUTE FUNCTION crm_notification_record();
CREATE TRIGGER crm_notification_record AFTER INSERT OR UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION crm_notification_record();
CREATE TRIGGER crm_notification_record AFTER INSERT OR UPDATE ON "Deal" FOR EACH ROW EXECUTE FUNCTION crm_notification_record();
CREATE TRIGGER crm_notification_record AFTER INSERT OR UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION crm_notification_record();
CREATE TRIGGER crm_notification_record AFTER INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION crm_notification_record();

CREATE FUNCTION crm_notification_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id text; stage_name text; won boolean; lost boolean;
BEGIN
 SELECT "assignedUserId" INTO owner_id FROM "Deal" WHERE id=NEW."dealId" AND "tenantId"=NEW."tenantId";
 SELECT name,"isWon","isLost" INTO stage_name,won,lost FROM "Stage" WHERE id=NEW."newStageId" AND "tenantId"=NEW."tenantId";
 IF won OR lost OR lower(stage_name) IN ('contacted','qualified') THEN
   PERFORM crm_enqueue_notification(NEW."tenantId",'deal-stage:'||NEW.id,
     CASE WHEN won THEN 'deal_won' WHEN lost THEN 'deal_lost' ELSE 'deal_progressed' END,'Deal',NEW."dealId",owner_id,
     won OR lost OR lower(stage_name)='qualified',NULL,jsonb_build_object('stage',stage_name,'historyId',NEW.id));
   IF lower(stage_name)='qualified' THEN
     PERFORM crm_enqueue_notification(NEW."tenantId",'closing-needed:'||NEW.id,'closing_requirements_needed','Deal',NEW."dealId",owner_id);
   END IF;
   IF won THEN
     PERFORM crm_enqueue_notification(NEW."tenantId",'closing-completed:'||NEW.id,'closing_requirements_completed','Deal',NEW."dealId",NULL,true);
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_stage AFTER INSERT ON "DealStageHistory" FOR EACH ROW EXECUTE FUNCTION crm_notification_stage();

CREATE FUNCTION crm_notification_task_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."dueDate",NEW."reminderAt",NEW."assignedUserId",NEW.status,NEW."isArchived")
   IS DISTINCT FROM (OLD."dueDate",OLD."reminderAt",OLD."assignedUserId",OLD.status,OLD."isArchived") THEN
   NEW."notificationVersion" := OLD."notificationVersion"+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_task_version BEFORE UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION crm_notification_task_version();
CREATE FUNCTION crm_schedule_task_notifications(task_row "Task") RETURNS void LANGUAGE plpgsql AS $$
DECLARE facts jsonb; suffix text; reminder timestamp;
BEGIN
 IF task_row."isArchived" OR task_row.status IN ('completed','cancelled') THEN RETURN; END IF;
 facts := jsonb_build_object('version',task_row."notificationVersion");
 suffix := task_row.id||':'||to_char(task_row."dueDate",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||':'||task_row."assignedUserId";
 IF task_row."notificationVersion">0 THEN suffix := suffix||':v'||task_row."notificationVersion"; END IF;
 reminder := coalesce(task_row."reminderAt",task_row."dueDate"-interval '24 hours');
 PERFORM crm_enqueue_notification(task_row."tenantId",'task:due:'||suffix,'task_due','Task',task_row.id,
   task_row."assignedUserId",false,NULL,facts,reminder);
 PERFORM crm_enqueue_notification(task_row."tenantId",'task:overdue:'||suffix,'task_overdue','Task',task_row.id,
   task_row."assignedUserId",false,NULL,facts,task_row."dueDate");
END $$;
CREATE FUNCTION crm_notification_task_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM crm_schedule_task_notifications(NEW);
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_task_schedule AFTER INSERT OR UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION crm_notification_task_schedule();
-- One-time scheduling of current tasks. A pre-cutover missing notification could
-- have been deleted, so past reminders are consumed without recreating history.
-- Operators must reconcile legacy pending work before cutover (see the runbook).
DO $$ DECLARE task_row "Task"; BEGIN
 FOR task_row IN SELECT * FROM "Task" WHERE NOT "isArchived" AND status NOT IN ('completed','cancelled')
 LOOP PERFORM crm_schedule_task_notifications(task_row); END LOOP;
END $$;
INSERT INTO "NotificationDelivery" ("tenantId","userId","eventKey",outcome)
 SELECT "tenantId","ownerId","eventKey",'legacy_baseline' FROM "NotificationEvent"
 WHERE type IN ('task_due','task_overdue') AND "availableAt" <= CURRENT_TIMESTAMP AND "ownerId" IS NOT NULL
 ON CONFLICT DO NOTHING;
UPDATE "NotificationEvent" SET "processedAt"=CURRENT_TIMESTAMP
 WHERE type IN ('task_due','task_overdue') AND "availableAt" <= CURRENT_TIMESTAMP;

CREATE FUNCTION crm_notification_mailbox_incident() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."isActive" AND NEW."syncError" IS NULL THEN
   NEW."notificationIncidentId" := NULL; NEW."notificationFailedAt" := NULL;
 ELSIF TG_OP='INSERT' OR OLD."notificationIncidentId" IS NULL OR NEW."connectedAt" IS DISTINCT FROM OLD."connectedAt" THEN
   NEW."notificationIncidentId" := gen_random_uuid()::text; NEW."notificationFailedAt" := CURRENT_TIMESTAMP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_mailbox_incident BEFORE INSERT OR UPDATE ON "EmailAccount" FOR EACH ROW EXECUTE FUNCTION crm_notification_mailbox_incident();
CREATE FUNCTION crm_notification_mailbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."notificationIncidentId" IS NOT NULL THEN
   PERFORM crm_enqueue_notification(NEW."tenantId",'mailbox:'||NEW.id||':'||NEW."notificationIncidentId"||':'||NEW."isActive"::text,
     CASE WHEN NEW."isActive" THEN 'mailbox_sync_failed' ELSE 'mailbox_disconnected' END,'Mailbox',NEW.id,NEW."userId",true,NULL,
     jsonb_build_object('incidentId',NEW."notificationIncidentId"),
     CASE WHEN NEW."isActive" THEN NEW."notificationFailedAt"+interval '15 minutes' ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_mailbox AFTER INSERT OR UPDATE ON "EmailAccount" FOR EACH ROW EXECUTE FUNCTION crm_notification_mailbox();

CREATE FUNCTION crm_notification_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_row "EmailAccount"; assigned_id text;
BEGIN
 SELECT * INTO account_row FROM "EmailAccount" WHERE id=NEW."accountId" AND "tenantId"=NEW."tenantId";
 IF NEW."contactId" IS NOT NULL THEN
   SELECT "assignedUserId" INTO assigned_id FROM "Contact" WHERE id=NEW."contactId" AND "tenantId"=NEW."tenantId";
 ELSE
   SELECT "assignedUserId" INTO assigned_id FROM "Lead" WHERE id=NEW."leadId" AND "tenantId"=NEW."tenantId";
 END IF;
 -- Initial history before connection never generates customer-reply alerts.
 IF NEW.direction='inbound' AND NEW."sentAt">account_row."connectedAt" AND assigned_id=account_row."userId" AND
    (NEW."leadId" IS NOT NULL OR NEW."contactId" IS NOT NULL) AND NOT NEW.labels && ARRAY['SPAM','TRASH','DELETED','DRAFT'] THEN
   PERFORM crm_enqueue_notification(NEW."tenantId",'reply:'||coalesce(NEW."rfcMessageId",NEW."accountId"||':'||NEW."providerMessageId")||':'||assigned_id,
     'customer_reply','MailboxMessage',NEW.id,account_row."userId",false,NULL);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_message AFTER INSERT ON "MailboxMessage" FOR EACH ROW EXECUTE FUNCTION crm_notification_message();

CREATE FUNCTION crm_notification_campaign_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."submissionStartedAt",NEW."scheduledFor") IS DISTINCT FROM (OLD."submissionStartedAt",OLD."scheduledFor")
   OR (OLD.status::text IN ('FAILED','PAUSED','PARTIALLY_SENT') AND NEW.status::text IN ('DRAFT','SCHEDULED','SENDING','ACTIVE'))
   OR (OLD."failedCount">0 AND NEW."failedCount"=0) THEN
   NEW."notificationRunVersion" := OLD."notificationRunVersion"+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_campaign_version BEFORE UPDATE ON "Campaign" FOR EACH ROW EXECUTE FUNCTION crm_notification_campaign_version();

CREATE FUNCTION crm_notification_operations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n jsonb := to_jsonb(NEW); o jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 t text := n->>'tenantId'; eid text := n->>'id'; source_id text := gen_random_uuid()::text; campaign_row "Campaign";
BEGIN
 IF TG_TABLE_NAME='WorkflowExecutionRun' AND n->>'status'='failed' AND o->>'status' IS DISTINCT FROM 'failed' THEN
   PERFORM crm_enqueue_notification(t,'workflow-failed:'||eid,'workflow_failed','Workflow',n->>'workflowId',NULL,true,NULL,jsonb_build_object('runId',eid));
 ELSIF TG_TABLE_NAME='Campaign' AND
    ((n->>'status'='FAILED' AND o->>'status' IS DISTINCT FROM 'FAILED') OR
     (coalesce((n->>'failedCount')::int,0)>0 AND coalesce((o->>'failedCount')::int,0)=0)) THEN
   PERFORM crm_enqueue_notification(t,'campaign-failed:'||eid||':v'||(n->>'notificationRunVersion'),
     'campaign_failed','Campaign',eid,n->>'createdById',true);
 ELSIF TG_TABLE_NAME='AuditLog' THEN
   IF n->>'action'='form.processing_failed' AND n->>'entityId' IS NOT NULL THEN
     PERFORM crm_enqueue_notification(t,'audit:'||eid,'form_processing_failed','Form',n->>'entityId',NULL,true);
   ELSIF n->>'action' IN ('campaign.delivery_interrupted','campaign.scheduled_failed') THEN
     SELECT * INTO campaign_row FROM "Campaign" WHERE id=n->>'entityId' AND "tenantId"=t;
     IF FOUND THEN
       PERFORM crm_enqueue_notification(t,'campaign-failed:'||campaign_row.id||':v'||campaign_row."notificationRunVersion",
         'campaign_failed','Campaign',campaign_row.id,campaign_row."createdById",true);
     END IF;
   ELSIF n->>'action' ~ '\.(archived|restored)$' AND n->>'entityType' IN ('Lead','Contact','Account','Deal','Workflow','Campaign') THEN
     PERFORM crm_enqueue_notification(t,'audit:'||eid,CASE WHEN n->>'action' LIKE '%.archived' THEN 'record_archived' ELSE 'record_restored' END,
       n->>'entityType',n->>'entityId',NULL,true);
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_notification_operations AFTER INSERT OR UPDATE ON "WorkflowExecutionRun" FOR EACH ROW EXECUTE FUNCTION crm_notification_operations();
CREATE TRIGGER crm_notification_operations AFTER INSERT OR UPDATE ON "Campaign" FOR EACH ROW EXECUTE FUNCTION crm_notification_operations();
CREATE TRIGGER crm_notification_operations AFTER INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION crm_notification_operations();
CREATE TRIGGER crm_scope_immutable BEFORE UPDATE ON "NotificationEvent" FOR EACH ROW EXECUTE FUNCTION crm_scope_immutable();
CREATE TRIGGER crm_scope_immutable BEFORE UPDATE ON "NotificationDelivery" FOR EACH ROW EXECUTE FUNCTION crm_scope_immutable();
COMMIT;
