BEGIN;

-- Keep every configured step for review. Retired actions must never silently disappear.
UPDATE "Workflow" w SET "isActive" = false, status = 'PAUSED', "updatedAt" = now()
WHERE w."isActive" AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.actions) = 'array' THEN w.actions ELSE '[]'::jsonb END) action
  WHERE action->>'type' IN ('send_campaign', 'create_notification')
    AND coalesce(action->>'enabled', 'true') <> 'false'
);

-- Existing incorrectly configured copies must be reviewed against the new recipe.
UPDATE "Workflow" w SET "isActive" = false, status = 'PAUSED', "updatedAt" = now()
WHERE w."isActive" AND workflow_name_key(w.name) = 'qualified deal follow-up'
  AND (w.trigger <> 'deal.stage_changed' OR NOT coalesce(w.conditions @> '{"operator":"AND","conditions":[{"field":"deal.hasEverBeenWon","operator":"equals","value":false},{"field":"deal.wonHistoryVerified","operator":"equals","value":true}]}', false)
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.conditions->'conditions') = 'array' THEN w.conditions->'conditions' ELSE '[]'::jsonb END) rule
      JOIN "Stage" s ON s.id = rule->>'value' AND s."tenantId" = w."tenantId"
      WHERE rule->>'field' IN ('event.newStageId', 'deal.stageId') AND rule->>'operator' = 'equals'
        AND lower(btrim(s.name)) = 'qualified' AND NOT s."isWon" AND NOT s."isLost"
    ));

-- Others is a real selectable interest with an explicit zero starting estimate.
-- Do not replace an existing catalog definition or re-enable a removed field.
INSERT INTO "ProductInterest" (id, "tenantId", name, "dealValue", active, "createdAt", "updatedAt")
SELECT md5(t.id || ':workflow-product-others')::uuid::text, t.id, 'Others', 0, true, now(), now()
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "ProductInterest" p WHERE p."tenantId" = t.id AND lower(btrim(p.name)) = 'others')
  AND NOT EXISTS (SELECT 1 FROM "TenantPreference" p WHERE p."tenantId" = t.id AND p.module = 'product-interests' AND p.key = 'enabled' AND p.value = 'false'::jsonb);
COMMIT;
