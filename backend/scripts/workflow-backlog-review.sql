-- Operator-only rollout helper. Defaults to read-only review. Never apply with workers active.
\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply false
\endif
\if :{?workers_stopped}
\else
  \set workers_stopped false
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL timezone = 'UTC';

-- Required psql parameters are quoted as values, never SQL identifiers or fragments.
CREATE TEMP TABLE workflow_rollout_input ON COMMIT DROP AS
SELECT :'tenant_id'::text AS tenant_id, :'cutoff'::timestamptz AS cutoff;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Tenant" t JOIN workflow_rollout_input i ON t.id = i.tenant_id)
    THEN RAISE EXCEPTION 'The explicitly selected tenant does not exist'; END IF;
  IF EXISTS (SELECT 1 FROM workflow_rollout_input WHERE cutoff > clock_timestamp())
    THEN RAISE EXCEPTION 'The rollout cutoff cannot be in the future'; END IF;
END $$;

-- Retain suspicious/in-flight evidence for separate review; do not guess provider outcomes.
CREATE TEMP TABLE workflow_retirement_candidates ON COMMIT DROP AS
SELECT r.id, r."workflowId", r."workflowVersion", r.status, r."startedAt"
FROM "WorkflowExecutionRun" r JOIN workflow_rollout_input i ON r."tenantId" = i.tenant_id
WHERE r.status = 'queued' AND r."dispatchStartedAt" IS NULL AND r."completedAt" IS NULL AND r."startedAt" < i.cutoff
  AND (r."leaseId" IS NULL OR r."leaseUntil" < clock_timestamp())
  AND NOT EXISTS (SELECT 1 FROM "WorkflowExecutionStep" s WHERE s."executionId" = r.id
    AND (s.status <> 'skipped' OR s."resolvedInput" IS NOT NULL OR s.output IS NOT NULL OR s.error IS NOT NULL));

SELECT r."workflowId", w.name, r.status, count(*) AS run_count,
  min(r."startedAt") AS oldest_event, max(r."startedAt") AS newest_event,
  count(c.id) AS eligible_for_retirement
FROM "WorkflowExecutionRun" r JOIN workflow_rollout_input i ON r."tenantId" = i.tenant_id
JOIN "Workflow" w ON w.id = r."workflowId" AND w."tenantId" = r."tenantId"
LEFT JOIN workflow_retirement_candidates c ON c.id = r.id
WHERE r.status IN ('queued', 'running', 'interrupted')
GROUP BY r."workflowId", w.name, r.status ORDER BY w.name, r.status;
SELECT * FROM workflow_retirement_candidates ORDER BY "startedAt", id;

\if :apply
  \if :workers_stopped
  \else
    DO $$ BEGIN
      RAISE EXCEPTION 'Refusing apply: stop and drain every Workflow worker, then explicitly set workers_stopped=true';
    END $$;
  \endif
  CREATE TEMP TABLE workflow_rollout_approval ON COMMIT DROP AS
  SELECT :'expected_count'::integer AS expected_count, :'actor_id'::text AS actor_id;
  DO $$ BEGIN
    IF (SELECT count(*) FROM workflow_retirement_candidates) <> (SELECT expected_count FROM workflow_rollout_approval)
      THEN RAISE EXCEPTION 'Inventory count changed: review it again before applying'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "User" u JOIN workflow_rollout_input i ON u."tenantId" = i.tenant_id
      JOIN workflow_rollout_approval a ON u.id = a.actor_id WHERE u.status = 'ACTIVE')
      THEN RAISE EXCEPTION 'An active same-tenant operator identity is required for the audit receipt'; END IF;
    IF EXISTS (SELECT 1 FROM "WorkflowExecutionRun" r JOIN workflow_rollout_input i ON r."tenantId" = i.tenant_id
      WHERE r.status = 'running') THEN RAISE EXCEPTION 'Running executions remain: drain/reconcile first'; END IF;
  END $$;
  -- Conditional writes protect against a worker started accidentally during the approved cutover.
  CREATE TEMP TABLE workflow_retired ON COMMIT DROP AS
  WITH changed AS (
    UPDATE "WorkflowExecutionRun" r SET status = 'skipped', "completedAt" = clock_timestamp(),
      "errorMessage" = 'Pre-cutover event retired during the approved Workflow reliability rollout without replay.',
      "leaseId" = NULL, "leaseUntil" = NULL
    FROM workflow_retirement_candidates c, workflow_rollout_input i
    WHERE r.id = c.id AND r."tenantId" = i.tenant_id AND r.status = 'queued' AND r."dispatchStartedAt" IS NULL AND r."completedAt" IS NULL
      AND (r."leaseId" IS NULL OR r."leaseUntil" < clock_timestamp())
      AND NOT EXISTS (SELECT 1 FROM "WorkflowExecutionStep" s WHERE s."executionId" = r.id
        AND (s.status <> 'skipped' OR s."resolvedInput" IS NOT NULL OR s.output IS NOT NULL OR s.error IS NOT NULL))
    RETURNING r.id
  ) SELECT * FROM changed;
  DO $$ BEGIN
    IF (SELECT count(*) FROM workflow_retired) <> (SELECT expected_count FROM workflow_rollout_approval)
      THEN RAISE EXCEPTION 'Executions changed during retirement: transaction rolled back'; END IF;
  END $$;
  INSERT INTO "AuditLog" (id, "tenantId", "userId", action, "entityType", category, severity, metadata, "createdAt")
  SELECT gen_random_uuid()::text, i.tenant_id, a.actor_id, 'workflow.backlog_retired', 'WorkflowExecutionRun', 'workflow', 'INFO',
    jsonb_build_object('cutoff', i.cutoff, 'count', a.expected_count, 'runIds', (SELECT coalesce(jsonb_agg(id), '[]'::jsonb) FROM workflow_retired)), clock_timestamp()
  FROM workflow_rollout_input i CROSS JOIN workflow_rollout_approval a;
  COMMIT;
\else
  ROLLBACK;
\endif
