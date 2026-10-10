BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE "Lead" IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ClosingFieldDefinition" WHERE id IN ('retired-lead-description','retired-lead-website','retired-lead-productInterestOther')) THEN
    RAISE EXCEPTION 'Lead archival field IDs already exist; resolve the collision before preservation';
  END IF;
END $$;
-- Hidden, inactive archival values preserve exact historical text without adding
-- any standard or custom inputs to the final Lead form.
CREATE FUNCTION crm_preserve_retired_lead_fields() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field_name text; field_value text; field_id text;
BEGIN
  FOREACH field_name IN ARRAY ARRAY['description','website','productInterestOther'] LOOP
    field_value := to_jsonb(NEW)->>field_name;
    IF field_value IS NULL THEN CONTINUE; END IF;
    field_id := 'retired-lead-' || field_name;
    INSERT INTO "ClosingFieldDefinition" ("tenantId", id, definition, "createdAt", "updatedAt")
      VALUES (NEW."tenantId", field_id, jsonb_build_object('id',field_id,'name','Historical Lead ' || initcap(field_name),
        'type','Long Text','module','leads','group','Additional Information','visibleInForm',false,
        'active',false,'required',false,'order',99999,'version',1,'options','[]'::jsonb,
        'description','Preserved from a retired Lead column.'), NOW(), NOW())
      ON CONFLICT ("tenantId",id) DO NOTHING;
    INSERT INTO "CustomFieldValue" (id,"tenantId","fieldId",module,"leadId",value,"createdAt","updatedAt")
      VALUES (md5(NEW.id || ':' || field_id),NEW."tenantId",field_id,'leads',NEW.id,to_jsonb(field_value),NEW."createdAt",NOW())
      ON CONFLICT ("tenantId","fieldId","leadId") DO UPDATE SET value=EXCLUDED.value,"updatedAt"=EXCLUDED."updatedAt";
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_preserve_retired_lead_fields AFTER INSERT OR UPDATE OF description,website,"productInterestOther" ON "Lead"
FOR EACH ROW EXECUTE FUNCTION crm_preserve_retired_lead_fields();
-- Trigger performs an exact copy, including empty strings. Do not touch updatedAt.
UPDATE "Lead" SET description=description WHERE description IS NOT NULL OR website IS NOT NULL OR "productInterestOther" IS NOT NULL;
COMMIT;
