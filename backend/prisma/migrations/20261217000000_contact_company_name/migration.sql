-- Breaking release: drain submissions/Workflow dispatch and stop old writers first.
-- Rename in place; Contact values, identities, provenance and foreign keys survive.
BEGIN;
LOCK TABLE "Contact" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "Template", "Campaign", "Workflow", "TargetAudienceCondition", "TenantPreference" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Campaign" WHERE status = 'SENDING')
     OR EXISTS (SELECT 1 FROM "WorkflowExecutionRun"
       WHERE status IN ('queued', 'running') AND "dispatchContext" IS NOT NULL AND "dispatchContext" <> 'null'::jsonb) THEN
    RAISE EXCEPTION 'CONTACT_COMPANY_RENAME_REQUIRES_DRAIN: finish Campaign submissions and queued/running Workflows before stopping old writers';
  END IF;
  IF EXISTS (SELECT 1 FROM "TenantPreference" WHERE module = 'contacts' AND key = 'field-layout'
    AND value->'fields' ? 'company' AND value->'fields' ? 'companyName'
    AND value->'fields'->'company' IS DISTINCT FROM value->'fields'->'companyName') THEN
    RAISE EXCEPTION 'CONTACT_COMPANY_LAYOUT_CONFLICT: resolve conflicting company/companyName overrides before retrying';
  END IF;
END $$;

ALTER TABLE "Contact" RENAME COLUMN "company" TO "companyName";

-- Session-local helpers touch exact tokens/selectors, never arbitrary text keys.
CREATE FUNCTION pg_temp.contact_company_tokens(text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace($1, '\{\{\s*company\s*\}\}', '{{companyName}}', 'g');
$$;

CREATE FUNCTION pg_temp.contact_company_selectors(input jsonb, contact_fields boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; entry record;
BEGIN
  IF jsonb_typeof(input) = 'array' THEN
    SELECT COALESCE(jsonb_agg(pg_temp.contact_company_selectors(value, contact_fields) ORDER BY ord), '[]'::jsonb)
      INTO result FROM jsonb_array_elements(input) WITH ORDINALITY AS items(value, ord);
    RETURN result;
  ELSIF jsonb_typeof(input) <> 'object' OR input IS NULL THEN
    RETURN input;
  END IF;
  result := input;
  FOR entry IN SELECT * FROM jsonb_each(input) LOOP
    result := jsonb_set(result, ARRAY[entry.key], pg_temp.contact_company_selectors(entry.value, contact_fields));
  END LOOP;
  IF input->>'field' = 'contact.company' THEN
    result := jsonb_set(result, '{field}', '"contact.companyName"');
  ELSIF contact_fields AND input->>'field' = 'company' THEN
    result := jsonb_set(result, '{field}', '"companyName"');
  END IF;
  IF contact_fields AND input->>'field' = 'event.changedFields' THEN
    IF input->'value' = '"company"'::jsonb THEN
      result := jsonb_set(result, '{value}', '"companyName"');
    ELSIF jsonb_typeof(input->'value') = 'array' THEN
      SELECT jsonb_agg(CASE WHEN value = '"company"'::jsonb THEN '"companyName"'::jsonb ELSE value END ORDER BY ord)
        INTO result FROM jsonb_array_elements(input->'value') WITH ORDINALITY AS items(value, ord);
      result := jsonb_set(pg_temp.contact_company_selectors(input - 'value', contact_fields), '{value}', COALESCE(result, '[]'::jsonb));
    END IF;
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION pg_temp.contact_company_actions(input jsonb, contact_fields boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb := '[]'; action jsonb; config jsonb; message_key text;
BEGIN
  IF jsonb_typeof(input) <> 'array' THEN RETURN input; END IF;
  FOR action IN SELECT value FROM jsonb_array_elements(input) LOOP
    config := action->'config';
    IF jsonb_typeof(config) = 'object' THEN
      IF contact_fields AND action->>'type' = 'update_field' AND config->>'field' = 'company' THEN
        config := jsonb_set(config, '{field}', '"companyName"');
      END IF;
      FOREACH message_key IN ARRAY ARRAY['title', 'description', 'subject', 'body', 'message'] LOOP
        IF jsonb_typeof(config->message_key) = 'string' THEN
          config := jsonb_set(config, ARRAY[message_key], to_jsonb(pg_temp.contact_company_tokens(config->>message_key)));
        END IF;
      END LOOP;
      action := jsonb_set(action, '{config}', config);
    END IF;
    result := result || jsonb_build_array(action);
  END LOOP;
  RETURN result;
END $$;

UPDATE "Template" SET subject = pg_temp.contact_company_tokens(subject), content = pg_temp.contact_company_tokens(content)
WHERE subject IS DISTINCT FROM pg_temp.contact_company_tokens(subject)
   OR content IS DISTINCT FROM pg_temp.contact_company_tokens(content);

UPDATE "Campaign" SET subject = pg_temp.contact_company_tokens(subject), body = pg_temp.contact_company_tokens(body),
  "scheduleConfig" = pg_temp.contact_company_selectors("scheduleConfig", true)
WHERE subject IS DISTINCT FROM pg_temp.contact_company_tokens(subject)
   OR body IS DISTINCT FROM pg_temp.contact_company_tokens(body)
   OR "scheduleConfig" IS DISTINCT FROM pg_temp.contact_company_selectors("scheduleConfig", true);

UPDATE "TargetAudienceCondition" SET field = 'companyName' WHERE field = 'company';

UPDATE "Workflow" SET conditions = pg_temp.contact_company_selectors(conditions, trigger LIKE 'contact.%'),
  actions = pg_temp.contact_company_actions(actions, trigger LIKE 'contact.%')
WHERE conditions IS DISTINCT FROM pg_temp.contact_company_selectors(conditions, trigger LIKE 'contact.%')
   OR actions IS DISTINCT FROM pg_temp.contact_company_actions(actions, trigger LIKE 'contact.%');

UPDATE "TenantPreference" SET value = jsonb_set(
  jsonb_set(value, '{fields}', ((value->'fields') - 'company') || jsonb_build_object('companyName', value->'fields'->'company')),
  '{revision}', to_jsonb(COALESCE((value->>'revision')::integer, 0) + 1))
WHERE module = 'contacts' AND key = 'field-layout' AND value->'fields' ? 'company';

DROP FUNCTION pg_temp.contact_company_actions(jsonb, boolean);
DROP FUNCTION pg_temp.contact_company_selectors(jsonb, boolean);
DROP FUNCTION pg_temp.contact_company_tokens(text);
COMMIT;
