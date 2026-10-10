BEGIN;

-- Abort rather than silently dropping invalid existing associations.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Task" t LEFT JOIN "Lead" r ON r."id" = t."leadId" AND r."tenantId" = t."tenantId" AND r."environment" = t."environment" WHERE t."leadId" IS NOT NULL AND r."id" IS NULL) THEN
    RAISE EXCEPTION 'Task Lead links contain missing or cross-scope records; repair these before retrying this migration.';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Task" t LEFT JOIN "Contact" r ON r."id" = t."contactId" AND r."tenantId" = t."tenantId" AND r."environment" = t."environment" WHERE t."contactId" IS NOT NULL AND r."id" IS NULL) THEN
    RAISE EXCEPTION 'Task Contact links contain missing or cross-scope records; repair these before retrying this migration.';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Task" t LEFT JOIN "Deal" r ON r."id" = t."dealId" AND r."tenantId" = t."tenantId" AND r."environment" = t."environment" WHERE t."dealId" IS NOT NULL AND r."id" IS NULL) THEN
    RAISE EXCEPTION 'Task Deal links contain missing or cross-scope records; repair these before retrying this migration.';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Task" t LEFT JOIN "Account" r ON r."id" = t."accountId" AND r."tenantId" = t."tenantId" AND r."environment" = t."environment" WHERE t."accountId" IS NOT NULL AND r."id" IS NULL) THEN
    RAISE EXCEPTION 'Task Account links contain missing or cross-scope records; repair these before retrying this migration.';
  END IF;
END $$;

-- CreateTable
CREATE TABLE "TaskLead" (
    "taskId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" "CrmEnvironment" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskLead_pkey" PRIMARY KEY ("taskId","leadId")
);

-- CreateTable
CREATE TABLE "TaskContact" (
    "taskId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" "CrmEnvironment" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskContact_pkey" PRIMARY KEY ("taskId","contactId")
);

-- CreateTable
CREATE TABLE "TaskDeal" (
    "taskId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" "CrmEnvironment" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskDeal_pkey" PRIMARY KEY ("taskId","dealId")
);

-- CreateTable
CREATE TABLE "TaskAccount" (
    "taskId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "environment" "CrmEnvironment" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskAccount_pkey" PRIMARY KEY ("taskId","accountId")
);

-- CreateIndex
CREATE INDEX "TaskLead_tenantId_environment_leadId_idx" ON "TaskLead"("tenantId", "environment", "leadId");

-- CreateIndex
CREATE INDEX "TaskContact_tenantId_environment_contactId_idx" ON "TaskContact"("tenantId", "environment", "contactId");

-- CreateIndex
CREATE INDEX "TaskDeal_tenantId_environment_dealId_idx" ON "TaskDeal"("tenantId", "environment", "dealId");

-- CreateIndex
CREATE INDEX "TaskAccount_tenantId_environment_accountId_idx" ON "TaskAccount"("tenantId", "environment", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_id_tenantId_environment_key" ON "Account"("id", "tenantId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_id_tenantId_environment_key" ON "Lead"("id", "tenantId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_tenantId_environment_key" ON "Contact"("id", "tenantId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_id_tenantId_environment_key" ON "Deal"("id", "tenantId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_tenantId_environment_key" ON "Task"("id", "tenantId", "environment");

-- AddForeignKey
ALTER TABLE "TaskLead" ADD CONSTRAINT "TaskLead_taskId_tenantId_environment_fkey" FOREIGN KEY ("taskId", "tenantId", "environment") REFERENCES "Task"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLead" ADD CONSTRAINT "TaskLead_leadId_tenantId_environment_fkey" FOREIGN KEY ("leadId", "tenantId", "environment") REFERENCES "Lead"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskContact" ADD CONSTRAINT "TaskContact_taskId_tenantId_environment_fkey" FOREIGN KEY ("taskId", "tenantId", "environment") REFERENCES "Task"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskContact" ADD CONSTRAINT "TaskContact_contactId_tenantId_environment_fkey" FOREIGN KEY ("contactId", "tenantId", "environment") REFERENCES "Contact"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDeal" ADD CONSTRAINT "TaskDeal_taskId_tenantId_environment_fkey" FOREIGN KEY ("taskId", "tenantId", "environment") REFERENCES "Task"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDeal" ADD CONSTRAINT "TaskDeal_dealId_tenantId_environment_fkey" FOREIGN KEY ("dealId", "tenantId", "environment") REFERENCES "Deal"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAccount" ADD CONSTRAINT "TaskAccount_taskId_tenantId_environment_fkey" FOREIGN KEY ("taskId", "tenantId", "environment") REFERENCES "Task"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAccount" ADD CONSTRAINT "TaskAccount_accountId_tenantId_environment_fkey" FOREIGN KEY ("accountId", "tenantId", "environment") REFERENCES "Account"("id", "tenantId", "environment") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve every existing single link, including archived records.
INSERT INTO "TaskLead" ("taskId", "leadId", "tenantId", "environment", "position")
SELECT "id", "leadId", "tenantId", "environment", 0 FROM "Task" WHERE "leadId" IS NOT NULL;
INSERT INTO "TaskContact" ("taskId", "contactId", "tenantId", "environment", "position")
SELECT "id", "contactId", "tenantId", "environment", 0 FROM "Task" WHERE "contactId" IS NOT NULL;
INSERT INTO "TaskDeal" ("taskId", "dealId", "tenantId", "environment", "position")
SELECT "id", "dealId", "tenantId", "environment", 0 FROM "Task" WHERE "dealId" IS NOT NULL;
INSERT INTO "TaskAccount" ("taskId", "accountId", "tenantId", "environment", "position")
SELECT "id", "accountId", "tenantId", "environment", 0 FROM "Task" WHERE "accountId" IS NOT NULL;

COMMIT;
