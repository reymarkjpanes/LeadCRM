BEGIN;
-- Expand/backfill only. Legacy arrays remain intact for reconciliation and rollback.
-- Deploy with the application switch during a write pause; old writers use arrays.
CREATE UNIQUE INDEX "ProductInterest_id_tenantId_key" ON "ProductInterest" ("id", "tenantId");

ALTER TABLE "Lead" ADD COLUMN "productsNormalized" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "LeadProductInterest" (
 "leadId" TEXT NOT NULL, "productInterestId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "position" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "LeadProductInterest_pkey" PRIMARY KEY ("leadId", "productInterestId"),
 CONSTRAINT "LeadProductInterest_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LeadProductInterest_productInterestId_tenantId_fkey" FOREIGN KEY ("productInterestId", "tenantId") REFERENCES "ProductInterest" ("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LeadProductInterest_tenantId_productInterestId_idx" ON "LeadProductInterest" ("tenantId", "productInterestId");
CREATE TEMP TABLE "LeadProductMatches" ON COMMIT DROP AS
SELECT r.id, r."tenantId", 'productInterestIds' AS field, v.value, v.position + 0 AS position,
 (SELECT CASE WHEN count(*)=1 THEN min(p.id) END FROM "ProductInterest" p WHERE p."tenantId"=r."tenantId" AND p.id=v.value) AS product_id
FROM "Lead" r CROSS JOIN LATERAL unnest(r."productInterestIds") WITH ORDINALITY v(value,position)
UNION ALL
SELECT r.id, r."tenantId", 'productInterest' AS field, v.value, v.position + 100 AS position,
 (SELECT CASE WHEN count(*)=1 THEN min(p.id) END FROM "ProductInterest" p WHERE p."tenantId"=r."tenantId" AND lower(btrim(p.name))=lower(btrim(v.value))) AS product_id
FROM "Lead" r CROSS JOIN LATERAL unnest(r."productInterest") WITH ORDINALITY v(value,position);
INSERT INTO "LeadProductInterest" ("leadId", "productInterestId", "tenantId", position)
SELECT id,product_id,"tenantId",min(position)::int FROM "LeadProductMatches" WHERE product_id IS NOT NULL GROUP BY id,product_id,"tenantId";
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "LeadProductMatches" m WHERE product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "LeadProductInterest" j WHERE j."leadId"=m.id AND j."tenantId"=m."tenantId" AND j."productInterestId"=m.product_id)) THEN
 RAISE EXCEPTION 'Lead product backfill verification failed'; END IF;
END $$;
UPDATE "Lead" r SET "productsNormalized"=true WHERE NOT EXISTS (SELECT 1 FROM "LeadProductMatches" m WHERE m.id=r.id AND m.product_id IS NULL);

ALTER TABLE "Contact" ADD COLUMN "productsNormalized" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ContactProductInterest" (
 "contactId" TEXT NOT NULL, "productInterestId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "position" INTEGER NOT NULL DEFAULT 0,
 "interested" BOOLEAN NOT NULL DEFAULT true, "activeProduct" BOOLEAN NOT NULL DEFAULT false,
 CONSTRAINT "ContactProductInterest_pkey" PRIMARY KEY ("contactId", "productInterestId"),
 CONSTRAINT "ContactProductInterest_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ContactProductInterest_productInterestId_tenantId_fkey" FOREIGN KEY ("productInterestId", "tenantId") REFERENCES "ProductInterest" ("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ContactProductInterest_tenantId_productInterestId_idx" ON "ContactProductInterest" ("tenantId", "productInterestId");
CREATE TEMP TABLE "ContactProductMatches" ON COMMIT DROP AS
SELECT r.id, r."tenantId", 'productInterests' AS field, v.value, v.position + 0 AS position,
 (SELECT CASE WHEN count(*)=1 THEN min(p.id) END FROM "ProductInterest" p WHERE p."tenantId"=r."tenantId" AND lower(btrim(p.name))=lower(btrim(v.value))) AS product_id
FROM "Contact" r CROSS JOIN LATERAL unnest(r."productInterests") WITH ORDINALITY v(value,position)
UNION ALL
SELECT r.id, r."tenantId", 'activeProducts' AS field, v.value, v.position + 100 AS position,
 (SELECT CASE WHEN count(*)=1 THEN min(p.id) END FROM "ProductInterest" p WHERE p."tenantId"=r."tenantId" AND lower(btrim(p.name))=lower(btrim(v.value))) AS product_id
FROM "Contact" r CROSS JOIN LATERAL unnest(r."activeProducts") WITH ORDINALITY v(value,position);
INSERT INTO "ContactProductInterest" ("contactId", "productInterestId", "tenantId", position, interested, "activeProduct")
SELECT id,product_id,"tenantId",min(position)::int, bool_or(field='productInterests'), bool_or(field='activeProducts') FROM "ContactProductMatches" WHERE product_id IS NOT NULL GROUP BY id,product_id,"tenantId";
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "ContactProductMatches" m WHERE product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ContactProductInterest" j WHERE j."contactId"=m.id AND j."tenantId"=m."tenantId" AND j."productInterestId"=m.product_id AND CASE WHEN m.field='activeProducts' THEN j."activeProduct" ELSE j.interested END)) THEN
 RAISE EXCEPTION 'Contact product backfill verification failed'; END IF;
END $$;
UPDATE "Contact" r SET "productsNormalized"=true WHERE NOT EXISTS (SELECT 1 FROM "ContactProductMatches" m WHERE m.id=r.id AND m.product_id IS NULL);

ALTER TABLE "Account" ADD COLUMN "productsNormalized" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "AccountProductInterest" (
 "accountId" TEXT NOT NULL, "productInterestId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "position" INTEGER NOT NULL DEFAULT 0,
 "interested" BOOLEAN NOT NULL DEFAULT true, "activeProduct" BOOLEAN NOT NULL DEFAULT false,
 CONSTRAINT "AccountProductInterest_pkey" PRIMARY KEY ("accountId", "productInterestId"),
 CONSTRAINT "AccountProductInterest_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AccountProductInterest_productInterestId_tenantId_fkey" FOREIGN KEY ("productInterestId", "tenantId") REFERENCES "ProductInterest" ("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AccountProductInterest_tenantId_productInterestId_idx" ON "AccountProductInterest" ("tenantId", "productInterestId");
CREATE TEMP TABLE "AccountProductMatches" ON COMMIT DROP AS
SELECT r.id, r."tenantId", 'productInterests' AS field, v.value, v.position + 0 AS position,
 (SELECT CASE WHEN count(*)=1 THEN min(p.id) END FROM "ProductInterest" p WHERE p."tenantId"=r."tenantId" AND lower(btrim(p.name))=lower(btrim(v.value))) AS product_id
FROM "Account" r CROSS JOIN LATERAL unnest(r."productInterests") WITH ORDINALITY v(value,position)
UNION ALL
SELECT r.id, r."tenantId", 'activeProducts' AS field, v.value, v.position + 100 AS position,
 (SELECT CASE WHEN count(*)=1 THEN min(p.id) END FROM "ProductInterest" p WHERE p."tenantId"=r."tenantId" AND lower(btrim(p.name))=lower(btrim(v.value))) AS product_id
FROM "Account" r CROSS JOIN LATERAL unnest(r."activeProducts") WITH ORDINALITY v(value,position);
INSERT INTO "AccountProductInterest" ("accountId", "productInterestId", "tenantId", position, interested, "activeProduct")
SELECT id,product_id,"tenantId",min(position)::int, bool_or(field='productInterests'), bool_or(field='activeProducts') FROM "AccountProductMatches" WHERE product_id IS NOT NULL GROUP BY id,product_id,"tenantId";
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "AccountProductMatches" m WHERE product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AccountProductInterest" j WHERE j."accountId"=m.id AND j."tenantId"=m."tenantId" AND j."productInterestId"=m.product_id AND CASE WHEN m.field='activeProducts' THEN j."activeProduct" ELSE j.interested END)) THEN
 RAISE EXCEPTION 'Account product backfill verification failed'; END IF;
END $$;
UPDATE "Account" r SET "productsNormalized"=true WHERE NOT EXISTS (SELECT 1 FROM "AccountProductMatches" m WHERE m.id=r.id AND m.product_id IS NULL);

-- Fill a primary product only when every historical token resolves unambiguously
-- to one product. Never split deals or change their value, names, or ID arrays.
ALTER TABLE "Deal" ADD COLUMN "productsNormalized" BOOLEAN NOT NULL DEFAULT false;
CREATE TEMP TABLE "DealProductMatches" ON COMMIT DROP AS
SELECT d.id,d."tenantId",v.value,
 (SELECT CASE WHEN count(*)=1 THEN min(p.id) END FROM "ProductInterest" p WHERE p."tenantId"=d."tenantId" AND CASE WHEN v.is_id THEN p.id=v.value ELSE lower(btrim(p.name))=lower(btrim(v.value)) END) AS product_id
FROM "Deal" d CROSS JOIN LATERAL (
 SELECT unnest(d."productInterestIds" || CASE WHEN d."productInterestId" IS NULL THEN ARRAY[]::text[] ELSE ARRAY[d."productInterestId"] END) AS value,true AS is_id
 UNION ALL SELECT unnest(d."productInterests"),false
) v;
UPDATE "Deal" d SET "productInterestId"=m.product_id, "productsNormalized"=true FROM (SELECT id,min(product_id) AS product_id FROM "DealProductMatches" GROUP BY id HAVING count(*)=count(product_id) AND count(DISTINCT product_id)=1) m WHERE d.id=m.id;

-- Reinforce scope without deleting any historical relationship.
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_productInterestId_fkey";
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_productInterestId_tenantId_fkey" FOREIGN KEY ("productInterestId", "tenantId") REFERENCES "ProductInterest" (id, "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve singular relationship history in the canonical junctions.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Deal" p LEFT JOIN "Lead" r ON r.id=p."leadId" AND r."tenantId"=p."tenantId" WHERE p."leadId" IS NOT NULL AND r.id IS NULL) THEN RAISE EXCEPTION 'Repair cross-tenant or orphan Deal.leadId before backfill'; END IF;
END $$;
INSERT INTO "LeadDeal" (id, "dealId", "leadId", "tenantId")
SELECT md5('LeadDeal:' || p.id || ':' || p."leadId")::uuid::text,p.id,p."leadId",p."tenantId" FROM "Deal" p WHERE p."leadId" IS NOT NULL ON CONFLICT ("leadId", "dealId") DO NOTHING;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Deal" p WHERE p."leadId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "LeadDeal" l WHERE l."dealId"=p.id AND l."leadId"=p."leadId" AND l."tenantId"=p."tenantId")) THEN RAISE EXCEPTION 'LeadDeal verification failed'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Deal" p LEFT JOIN "Contact" r ON r.id=p."contactId" AND r."tenantId"=p."tenantId" WHERE p."contactId" IS NOT NULL AND r.id IS NULL) THEN RAISE EXCEPTION 'Repair cross-tenant or orphan Deal.contactId before backfill'; END IF;
END $$;
INSERT INTO "ContactDeal" (id, "dealId", "contactId", "tenantId")
SELECT md5('ContactDeal:' || p.id || ':' || p."contactId")::uuid::text,p.id,p."contactId",p."tenantId" FROM "Deal" p WHERE p."contactId" IS NOT NULL ON CONFLICT ("contactId", "dealId") DO NOTHING;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Deal" p WHERE p."contactId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ContactDeal" l WHERE l."dealId"=p.id AND l."contactId"=p."contactId" AND l."tenantId"=p."tenantId")) THEN RAISE EXCEPTION 'ContactDeal verification failed'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Task" p LEFT JOIN "Lead" r ON r.id=p."leadId" AND r."tenantId"=p."tenantId" WHERE p."leadId" IS NOT NULL AND r.id IS NULL) THEN RAISE EXCEPTION 'Repair cross-tenant or orphan Task.leadId before backfill'; END IF;
END $$;
INSERT INTO "TaskLead" ("taskId", "leadId", "tenantId", position)
SELECT p.id,p."leadId",p."tenantId",COALESCE((SELECT max(position)+1 FROM "TaskLead" l WHERE l."taskId"=p.id),0) FROM "Task" p WHERE p."leadId" IS NOT NULL ON CONFLICT ("taskId", "leadId") DO NOTHING;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Task" p WHERE p."leadId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaskLead" l WHERE l."taskId"=p.id AND l."leadId"=p."leadId" AND l."tenantId"=p."tenantId")) THEN RAISE EXCEPTION 'TaskLead verification failed'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Task" p LEFT JOIN "Contact" r ON r.id=p."contactId" AND r."tenantId"=p."tenantId" WHERE p."contactId" IS NOT NULL AND r.id IS NULL) THEN RAISE EXCEPTION 'Repair cross-tenant or orphan Task.contactId before backfill'; END IF;
END $$;
INSERT INTO "TaskContact" ("taskId", "contactId", "tenantId", position)
SELECT p.id,p."contactId",p."tenantId",COALESCE((SELECT max(position)+1 FROM "TaskContact" l WHERE l."taskId"=p.id),0) FROM "Task" p WHERE p."contactId" IS NOT NULL ON CONFLICT ("taskId", "contactId") DO NOTHING;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Task" p WHERE p."contactId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaskContact" l WHERE l."taskId"=p.id AND l."contactId"=p."contactId" AND l."tenantId"=p."tenantId")) THEN RAISE EXCEPTION 'TaskContact verification failed'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Task" p LEFT JOIN "Deal" r ON r.id=p."dealId" AND r."tenantId"=p."tenantId" WHERE p."dealId" IS NOT NULL AND r.id IS NULL) THEN RAISE EXCEPTION 'Repair cross-tenant or orphan Task.dealId before backfill'; END IF;
END $$;
INSERT INTO "TaskDeal" ("taskId", "dealId", "tenantId", position)
SELECT p.id,p."dealId",p."tenantId",COALESCE((SELECT max(position)+1 FROM "TaskDeal" l WHERE l."taskId"=p.id),0) FROM "Task" p WHERE p."dealId" IS NOT NULL ON CONFLICT ("taskId", "dealId") DO NOTHING;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Task" p WHERE p."dealId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaskDeal" l WHERE l."taskId"=p.id AND l."dealId"=p."dealId" AND l."tenantId"=p."tenantId")) THEN RAISE EXCEPTION 'TaskDeal verification failed'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Task" p LEFT JOIN "Account" r ON r.id=p."accountId" AND r."tenantId"=p."tenantId" WHERE p."accountId" IS NOT NULL AND r.id IS NULL) THEN RAISE EXCEPTION 'Repair cross-tenant or orphan Task.accountId before backfill'; END IF;
END $$;
INSERT INTO "TaskAccount" ("taskId", "accountId", "tenantId", position)
SELECT p.id,p."accountId",p."tenantId",COALESCE((SELECT max(position)+1 FROM "TaskAccount" l WHERE l."taskId"=p.id),0) FROM "Task" p WHERE p."accountId" IS NOT NULL ON CONFLICT ("taskId", "accountId") DO NOTHING;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Task" p WHERE p."accountId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaskAccount" l WHERE l."taskId"=p.id AND l."accountId"=p."accountId" AND l."tenantId"=p."tenantId")) THEN RAISE EXCEPTION 'TaskAccount verification failed'; END IF;
END $$;

COMMIT;
