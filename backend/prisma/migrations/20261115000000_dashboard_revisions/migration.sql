-- Additive, transactional invalidation. Rollback rolls back counters as well.
ALTER TABLE "Deal" ADD COLUMN "revenueOwnerId" TEXT, ADD COLUMN "revenueOwnerEligible" BOOLEAN;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_revenueOwnerId_tenantId_fkey" FOREIGN KEY ("revenueOwnerId", "tenantId") REFERENCES "User"(id, "tenantId") ON DELETE RESTRICT;
-- No backfill: current ownership cannot establish historical sales attribution.
CREATE FUNCTION leadcrm_capture_revenue_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."revenueOwnerEligible" IS NOT NULL THEN
    NEW."revenueOwnerId" := OLD."revenueOwnerId";
    NEW."revenueOwnerEligible" := OLD."revenueOwnerEligible";
  ELSIF OLD."stageId" <> NEW."stageId" AND EXISTS (
    SELECT 1 FROM "Stage" WHERE id = NEW."stageId" AND "tenantId" = NEW."tenantId" AND "isWon"
  ) THEN
    NEW."revenueOwnerId" := (SELECT id FROM "User" WHERE id = NEW."assignedUserId" AND "tenantId" = NEW."tenantId");
    NEW."revenueOwnerEligible" := EXISTS (
      SELECT 1 FROM "User" u WHERE u.id = NEW."revenueOwnerId" AND u."tenantId" = NEW."tenantId"
        AND u.status = 'ACTIVE' AND lower(u.role) NOT IN ('client admin', 'guest')
        AND NOT EXISTS (SELECT 1 FROM (VALUES ('leads'), ('deals')) AS modules(module)
          WHERE NOT EXISTS (SELECT 1 FROM "UserRole" ur JOIN "RoleDefinition" r ON r.id = ur."roleId" AND r."tenantId" = ur."tenantId"
            JOIN "RolePermission" p ON p."roleId" = r.id AND p."tenantId" = r."tenantId"
            WHERE ur."userId" = u.id AND ur."tenantId" = u."tenantId" AND NOT r."isArchived"
              AND lower(r.name) NOT IN ('client admin', 'guest') AND p.module = modules.module AND p."canView")
          OR NOT EXISTS (SELECT 1 FROM "UserRole" ur JOIN "RoleDefinition" r ON r.id = ur."roleId" AND r."tenantId" = ur."tenantId"
            JOIN "RolePermission" p ON p."roleId" = r.id AND p."tenantId" = r."tenantId"
            WHERE ur."userId" = u.id AND ur."tenantId" = u."tenantId" AND NOT r."isArchived"
              AND lower(r.name) NOT IN ('client admin', 'guest') AND p.module = modules.module AND p."canEdit"))
    );
  ELSE
    NEW."revenueOwnerId" := OLD."revenueOwnerId";
    NEW."revenueOwnerEligible" := OLD."revenueOwnerEligible";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capture_revenue_owner BEFORE UPDATE ON "Deal" FOR EACH ROW EXECUTE FUNCTION leadcrm_capture_revenue_owner();
CREATE FUNCTION leadcrm_record_deal_start() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE actor TEXT;
BEGIN
  actor := COALESCE(NULLIF(current_setting('leadcrm.actor_id', true), ''), NEW."ownerId", NEW."assignedUserId");
  IF EXISTS (SELECT 1 FROM "User" WHERE id = actor AND "tenantId" = NEW."tenantId") THEN
    INSERT INTO "DealStageHistory" (id, "tenantId", "dealId", "newStageId", "movedById", "movedAt", note)
      VALUES (gen_random_uuid()::text, NEW."tenantId", NEW.id, NEW."stageId", actor, NEW."createdAt", 'Deal created in this stage.');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_deal_start AFTER INSERT ON "Deal" FOR EACH ROW EXECUTE FUNCTION leadcrm_record_deal_start();
CREATE TABLE "DashboardRevision" (
  "tenantId" TEXT PRIMARY KEY REFERENCES "Tenant"("id") ON DELETE CASCADE,
  analytics BIGINT NOT NULL DEFAULT 0, leads BIGINT NOT NULL DEFAULT 0,
  actions BIGINT NOT NULL DEFAULT 0, access BIGINT NOT NULL DEFAULT 0
);
CREATE FUNCTION leadcrm_dashboard_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE tenant_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
  -- Frequent session/login/profile writes do not invalidate reporting.
  IF TG_TABLE_NAME = 'User' AND TG_OP = 'UPDATE' THEN
    IF (NEW.status, NEW.role, NEW."firstName", NEW."lastName") IS NOT DISTINCT FROM
       (OLD.status, OLD.role, OLD."firstName", OLD."lastName") THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'Tenant' THEN
    IF (NEW.status, NEW.currency, NEW.name) IS NOT DISTINCT FROM (OLD.status, OLD.currency, OLD.name) THEN RETURN NEW; END IF;
    tenant_id := NEW.id;
  ELSE
    tenant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."tenantId" ELSE NEW."tenantId" END;
  END IF;
  -- Parent cascade deletion needs no notification and must not resurrect a row.
  IF EXISTS (SELECT 1 FROM "Tenant" WHERE id = tenant_id) THEN
    INSERT INTO "DashboardRevision" ("tenantId", analytics, leads, actions, access)
    VALUES (tenant_id, CASE WHEN TG_ARGV[0] = 'analytics' THEN 1 ELSE 0 END,
      CASE WHEN TG_ARGV[0] = 'leads' THEN 1 ELSE 0 END,
      CASE WHEN TG_ARGV[0] = 'actions' THEN 1 ELSE 0 END,
      CASE WHEN TG_ARGV[0] = 'access' THEN 1 ELSE 0 END)
    ON CONFLICT ("tenantId") DO UPDATE SET
      analytics = "DashboardRevision".analytics + EXCLUDED.analytics,
      leads = "DashboardRevision".leads + EXCLUDED.leads,
      actions = "DashboardRevision".actions + EXCLUDED.actions,
      access = "DashboardRevision".access + EXCLUDED.access;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Deal','Stage','Pipeline','DealStageHistory'] LOOP
    EXECUTE format('CREATE TRIGGER dashboard_revision AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION leadcrm_dashboard_revision(''analytics'')', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['Lead'] LOOP
    EXECUTE format('CREATE TRIGGER dashboard_revision AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION leadcrm_dashboard_revision(''leads'')', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['Task'] LOOP
    EXECUTE format('CREATE TRIGGER dashboard_revision AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION leadcrm_dashboard_revision(''actions'')', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['User','RoleDefinition','RolePermission','UserRole'] LOOP
    EXECUTE format('CREATE TRIGGER dashboard_revision AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION leadcrm_dashboard_revision(''access'')', table_name);
  END LOOP;
END $$;
CREATE TRIGGER dashboard_revision AFTER UPDATE ON "Tenant" FOR EACH ROW EXECUTE FUNCTION leadcrm_dashboard_revision('access');
CREATE INDEX "Deal_dashboard_closed" ON "Deal" ("tenantId", "pipelineId", "closedAt") WHERE NOT "isArchived" AND "deletedAt" IS NULL;
CREATE INDEX "Deal_dashboard_cohort" ON "Deal" ("tenantId", "pipelineId", "createdAt") WHERE NOT "isArchived" AND "deletedAt" IS NULL;
CREATE INDEX "DealStageHistory_dashboard_milestones" ON "DealStageHistory" ("tenantId", "dealId", "newStageId", "movedAt");
