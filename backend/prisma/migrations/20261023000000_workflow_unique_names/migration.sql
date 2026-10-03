BEGIN;

-- Use the same whitespace set as JavaScript \s, including non-breaking spaces.
-- An expression index protects all write routes without changing stored names.
CREATE OR REPLACE FUNCTION workflow_name_key(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT lower(btrim(regexp_replace(value,
    U&'[\0009-\000d\0020\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]+', ' ', 'g')));
$$;

LOCK TABLE "Workflow" IN SHARE ROW EXCLUSIVE MODE;

-- Never silently rename existing workflows. Operators must deliberately resolve
-- the reported conflicts, including archived workflows, then retry deployment.
DO $$
DECLARE conflicts text;
BEGIN
  SELECT string_agg(format('workspace=%s; name=%L; workflow IDs=%s',
    duplicate."tenantId", duplicate.name_key, duplicate.ids), E'\n')
  INTO conflicts
  FROM (
    SELECT "tenantId", workflow_name_key(name) AS name_key,
      string_agg(id, ', ' ORDER BY id) AS ids
    FROM "Workflow"
    GROUP BY "tenantId", workflow_name_key(name)
    HAVING count(*) > 1
    ORDER BY "tenantId", workflow_name_key(name)
    LIMIT 10
  ) duplicate;

  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate workflow names must be resolved before applying workflow name uniqueness.'
      USING DETAIL = conflicts,
        HINT = 'Rename the listed workflows intentionally. Archived names remain reserved. No workflows have been renamed or removed.';
  END IF;
END $$;

CREATE UNIQUE INDEX "Workflow_tenantId_normalizedName_key"
  ON "Workflow" ("tenantId", workflow_name_key(name));

COMMIT;
