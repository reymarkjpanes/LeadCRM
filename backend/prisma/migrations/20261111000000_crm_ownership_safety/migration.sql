BEGIN;
-- Assignment and user-status changes lock the same User row. This closes the
-- gap between application validation and a concurrent administrator deactivation.
CREATE FUNCTION crm_require_active_assignee() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."assignedUserId" IS NULL OR NEW."isArchived" OR NEW."deletedAt" IS NOT NULL
    OR (TG_TABLE_NAME='Lead' AND to_jsonb(NEW)->>'convertedAt' IS NOT NULL) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW."assignedUserId" IS NOT DISTINCT FROM OLD."assignedUserId"
    AND NOT OLD."isArchived" AND OLD."deletedAt" IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM "User" WHERE id=NEW."assignedUserId" AND "tenantId"=NEW."tenantId" AND status='ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assigned Agent is unavailable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_active_assignee BEFORE INSERT OR UPDATE ON "Lead" FOR EACH ROW EXECUTE FUNCTION crm_require_active_assignee();
CREATE TRIGGER crm_active_assignee BEFORE INSERT OR UPDATE ON "Contact" FOR EACH ROW EXECUTE FUNCTION crm_require_active_assignee();
CREATE TRIGGER crm_active_assignee BEFORE INSERT OR UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION crm_require_active_assignee();
CREATE TRIGGER crm_active_assignee BEFORE INSERT OR UPDATE ON "Deal" FOR EACH ROW EXECUTE FUNCTION crm_require_active_assignee();
CREATE FUNCTION crm_prevent_orphaned_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'ACTIVE' AND OLD.status='ACTIVE' AND (
    EXISTS (SELECT 1 FROM "Lead" WHERE "tenantId"=NEW."tenantId" AND "assignedUserId"=NEW.id AND NOT "isArchived" AND "deletedAt" IS NULL AND "convertedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM "Contact" WHERE "tenantId"=NEW."tenantId" AND "assignedUserId"=NEW.id AND NOT "isArchived" AND "deletedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM "Account" WHERE "tenantId"=NEW."tenantId" AND "assignedUserId"=NEW.id AND NOT "isArchived" AND "deletedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM "Deal" WHERE "tenantId"=NEW."tenantId" AND "assignedUserId"=NEW.id AND NOT "isArchived" AND "deletedAt" IS NULL)
  ) THEN RAISE EXCEPTION 'Reassign active CRM records before deactivation' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_ownership_before_deactivation BEFORE UPDATE OF status ON "User" FOR EACH ROW EXECUTE FUNCTION crm_prevent_orphaned_ownership();
COMMIT;
