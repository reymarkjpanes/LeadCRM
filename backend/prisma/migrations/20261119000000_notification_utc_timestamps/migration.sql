-- New outbox instants must use UTC regardless of a worker's database session zone.
-- Existing event/notification IDs, timestamps and delivery outcomes are preserved.
BEGIN;
ALTER TABLE "NotificationEvent"
  ALTER COLUMN "occurredAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  ALTER COLUMN "availableAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE "NotificationDelivery"
  ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE "Notification"
  ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

CREATE OR REPLACE FUNCTION crm_enqueue_notification(t text,k text,kind text,entity text,eid text,owner_id text DEFAULT NULL,
 admin_alert boolean DEFAULT false,actor_id text DEFAULT NULL,facts jsonb DEFAULT '{}',
 due timestamp DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
RETURNS void LANGUAGE sql AS $$
 INSERT INTO "NotificationEvent" ("tenantId","eventKey","type","entityType","entityId","ownerId","admins","actorId","payload","availableAt")
 VALUES (t,k,kind,entity,eid,owner_id,admin_alert,actor_id,facts,due) ON CONFLICT ("tenantId","eventKey") DO NOTHING;
$$;
CREATE OR REPLACE FUNCTION crm_notification_mailbox_incident() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."isActive" AND NEW."syncError" IS NULL THEN
   NEW."notificationIncidentId" := NULL; NEW."notificationFailedAt" := NULL;
 ELSIF TG_OP='INSERT' OR OLD."notificationIncidentId" IS NULL OR NEW."connectedAt" IS DISTINCT FROM OLD."connectedAt" THEN
   NEW."notificationIncidentId" := gen_random_uuid()::text;
   NEW."notificationFailedAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
 END IF;
 RETURN NEW;
END $$;
COMMIT;
